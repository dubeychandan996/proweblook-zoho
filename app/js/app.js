import { callProweblookZoho, sanitizeApiKey, sanitizeCountryCode } from './api.js';
import {
  extractZohoRecordContact,
  shouldSkipVerifiedZohoRecord,
  enrichZohoContacts,
} from './enrichment.js';
import { ZOHO_CRM_DELUGE_SNIPPET, ZOHO_BIGIN_DELUGE_SNIPPET } from './templates.js';

const STORAGE_KEY_API = 'pwl_zoho_session_api_key';
const STORAGE_KEY_COUNTRY = 'pwl_zoho_default_country';

const state = {
  entity: '',
  entityId: '',
  apiKey: '',
  defaultCountry: 'IN',
  lastEnriched: null,
  cache: new Map(),
};

function getZohoSdk() {
  return typeof globalThis.ZOHO !== 'undefined' ? globalThis.ZOHO : null;
}

function getZohoHttp() {
  const sdk = getZohoSdk();
  return sdk?.CRM?.HTTP && typeof sdk.CRM.HTTP.post === 'function' ? sdk.CRM.HTTP : null;
}

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(id, message, tone = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

function selectTab(tabId) {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.tab === tabId ? 'true' : 'false');
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabId;
  });
}

function renderRecordVerdict(enriched) {
  const box = document.getElementById('pwl-record-output');
  if (!box) return;
  const { verdict, emailResult, phoneResult, whatsappResult, callerResult } = enriched;
  box.hidden = false;
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div>
        <span class="pwl-badge pwl-badge-${escapeHtml(verdict.status)}">${escapeHtml(verdict.status)}</span>
        <strong style="margin-left:8px;">Trust Score: ${escapeHtml(verdict.score)}/100</strong>
      </div>
      <span style="font-size:11.5px;color:#475569;">Tag: <code>${escapeHtml(verdict.crmTag)}</code></span>
    </div>
    <div class="pwl-signals">
      <div class="pwl-signal-card">
        <strong>Email</strong>
        <span>${escapeHtml(emailResult ? `${emailResult.verdict} (${emailResult.reason || 'checked'})` : 'Not checked')}</span>
      </div>
      <div class="pwl-signal-card">
        <strong>Phone &amp; Line Type</strong>
        <span>${escapeHtml(
          phoneResult
            ? `${phoneResult.verdict} · ${phoneResult.details?.line_type || phoneResult.details?.linetype || 'line'} · ${phoneResult.details?.carrier || 'carrier'}`
            : 'Not checked'
        )}</span>
      </div>
      <div class="pwl-signal-card">
        <strong>Silent WhatsApp</strong>
        <span>${escapeHtml(whatsappResult ? whatsappResult.verdict : 'Not checked')}</span>
      </div>
      <div class="pwl-signal-card">
        <strong>Caller ID (CNAM)</strong>
        <span>${escapeHtml(
          callerResult
            ? `${callerResult.caller_name || callerResult.verdict} (${verdict.callerMatch})`
            : 'Not checked'
        )}</span>
      </div>
    </div>
  `;
}

async function loadOrgVariables() {
  try {
    const savedKey = sanitizeApiKey(sessionStorage.getItem(STORAGE_KEY_API) || '');
    const savedCc = sanitizeCountryCode(sessionStorage.getItem(STORAGE_KEY_COUNTRY) || '');
    if (savedKey) state.apiKey = savedKey;
    if (savedCc) state.defaultCountry = savedCc;
  } catch (_err) {
    // Ignore storage unavailability inside sandboxed iframes.
  }

  const sdk = getZohoSdk();
  if (sdk?.CRM?.API?.getOrgVariable) {
    for (const keyVar of ['proweblook__api_key', 'proweblook.api_key']) {
      try {
        const keyResp = await sdk.CRM.API.getOrgVariable(keyVar);
        const orgKey = sanitizeApiKey(keyResp?.Success?.Content || '');
        if (orgKey) {
          state.apiKey = orgKey;
          break;
        }
      } catch (_err) {
        // Ignore unconfigured variable name variant.
      }
    }
    for (const ccVar of ['proweblook__default_country_code', 'proweblook.default_country_code']) {
      try {
        const ccResp = await sdk.CRM.API.getOrgVariable(ccVar);
        const orgCc = sanitizeCountryCode(ccResp?.Success?.Content || '');
        if (orgCc) {
          state.defaultCountry = orgCc;
          break;
        }
      } catch (_err) {
        // Ignore unconfigured variable name variant.
      }
    }
  }

  const keyInput = document.getElementById('pwl-api-key');
  const ccInput = document.getElementById('pwl-default-country');
  const recCcInput = document.getElementById('pwl-rec-country');
  if (keyInput && state.apiKey) keyInput.value = state.apiKey;
  if (ccInput) ccInput.value = state.defaultCountry;
  if (recCcInput) recCcInput.value = state.defaultCountry;
}

async function handlePageLoad(data) {
  const entity = data?.Entity || '';
  const rawIds = data?.EntityId;
  const entityId = Array.isArray(rawIds) ? rawIds[0] : rawIds;
  state.entity = entity || '';
  state.entityId = entityId ? String(entityId) : '';

  const pill = document.getElementById('pwl-context-pill');
  if (pill) {
    pill.textContent = state.entity && state.entityId
      ? `${state.entity} #${state.entityId}`
      : 'Zoho CRM Connected';
  }

  const sdk = getZohoSdk();
  if (state.entity && state.entityId && sdk?.CRM?.API?.getRecord) {
    try {
      const resp = await sdk.CRM.API.getRecord({ Entity: state.entity, RecordID: state.entityId });
      const record = Array.isArray(resp?.data) ? resp.data[0] : null;
      if (record) {
        const contact = extractZohoRecordContact(record, state.defaultCountry);
        document.getElementById('pwl-rec-name').value = contact.name;
        document.getElementById('pwl-rec-email').value = contact.email;
        document.getElementById('pwl-rec-phone').value = contact.phone;
        document.getElementById('pwl-rec-country').value = contact.countryCode;
      }
    } catch (err) {
      setStatus('pwl-record-status', `Could not read Zoho record: ${err?.message || 'unknown error'}`, 'error');
    }
  }
}

async function runSingleRecordVerification() {
  const apiKey = sanitizeApiKey(document.getElementById('pwl-api-key').value || state.apiKey);
  if (!apiKey) {
    selectTab('settings');
    setStatus('pwl-settings-status', 'Paste your ProWebLook API key first (or set proweblook.api_key in Zoho CRM).', 'error');
    return;
  }
  state.apiKey = apiKey;

  const contact = {
    id: state.entityId,
    name: document.getElementById('pwl-rec-name').value.trim(),
    email: document.getElementById('pwl-rec-email').value.trim(),
    phone: document.getElementById('pwl-rec-phone').value.trim(),
    countryCode: sanitizeCountryCode(document.getElementById('pwl-rec-country').value) || state.defaultCountry,
  };

  if (!contact.email && !contact.phone) {
    setStatus('pwl-record-status', 'Enter an email address or phone number to verify.', 'error');
    return;
  }

  const checks = {
    email: document.getElementById('pwl-chk-email').checked,
    phone: document.getElementById('pwl-chk-phone').checked,
    whatsapp: document.getElementById('pwl-chk-wa').checked,
    callerId: document.getElementById('pwl-chk-caller').checked,
  };

  const btn = document.getElementById('pwl-btn-verify');
  const saveBtn = document.getElementById('pwl-btn-save-crm');
  btn.disabled = true;
  setStatus('pwl-record-status', 'Running ProWebLook verification...', 'info');

  try {
    const [enriched] = await enrichZohoContacts([contact], {
      apiKey,
      defaultCountry: contact.countryCode,
      checks,
      zohoHttp: getZohoHttp(),
      cache: state.cache,
    });
    state.lastEnriched = enriched;
    renderRecordVerdict(enriched);
    saveBtn.disabled = !(state.entity && state.entityId && getZohoSdk()?.CRM?.API);
    setStatus('pwl-record-status', 'Verification complete.', 'info');
  } catch (err) {
    setStatus('pwl-record-status', err?.message || 'Verification failed.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveVerdictToZohoCrm() {
  const sdk = getZohoSdk();
  if (!state.lastEnriched || !state.entity || !state.entityId || !sdk?.CRM?.API) return;

  const saveBtn = document.getElementById('pwl-btn-save-crm');
  saveBtn.disabled = true;
  setStatus('pwl-record-status', 'Saving verification note and tag to Zoho CRM...', 'info');

  try {
    const { verdict } = state.lastEnriched;
    if (typeof sdk.CRM.API.addNotes === 'function') {
      await sdk.CRM.API.addNotes({
        Entity: state.entity,
        RecordID: state.entityId,
        Title: verdict.noteTitle,
        Content: verdict.noteContent,
      });
    }
    setStatus('pwl-record-status', `Saved "${verdict.noteTitle}" to ${state.entity} #${state.entityId}.`, 'info');
  } catch (err) {
    setStatus('pwl-record-status', `Could not write note to Zoho CRM: ${err?.message || 'error'}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function runBulkModuleEnrichment() {
  const sdk = getZohoSdk();
  const apiKey = sanitizeApiKey(document.getElementById('pwl-api-key').value || state.apiKey);
  if (!apiKey) {
    selectTab('settings');
    setStatus('pwl-settings-status', 'Paste your ProWebLook API key first.', 'error');
    return;
  }
  if (!sdk?.CRM?.API?.getAllRecords) {
    setStatus('pwl-bulk-status', 'Open this widget inside Zoho CRM to load module records.', 'error');
    return;
  }

  const moduleName = document.getElementById('pwl-bulk-module').value;
  const maxRecords = Number(document.getElementById('pwl-bulk-limit').value) || 50;
  const runBtn = document.getElementById('pwl-btn-bulk-run');
  runBtn.disabled = true;
  setStatus('pwl-bulk-status', `Fetching ${moduleName} from Zoho CRM...`, 'info');

  try {
    const resp = await sdk.CRM.API.getAllRecords({
      Entity: moduleName,
      sort_order: 'desc',
      per_page: maxRecords,
      page: 1,
    });
    const rawRecords = Array.isArray(resp?.data) ? resp.data : [];
    const candidates = rawRecords
      .filter((rec) => !shouldSkipVerifiedZohoRecord(rec))
      .map((rec) => extractZohoRecordContact(rec, state.defaultCountry))
      .filter((c) => c.email || c.phone)
      .slice(0, maxRecords);

    if (!candidates.length) {
      setStatus('pwl-bulk-status', `No unverified ${moduleName} records with email/phone found on page 1.`, 'info');
      return;
    }

    const enrichedRows = await enrichZohoContacts(candidates, {
      apiKey,
      defaultCountry: state.defaultCountry,
      checks: { email: true, phone: true, whatsapp: true, callerId: false },
      zohoHttp: getZohoHttp(),
      cache: state.cache,
      onProgress: ({ completed, total }) => {
        setStatus('pwl-bulk-status', `Verified ${completed} / ${total} ${moduleName}...`, 'info');
      },
    });

    const tbody = document.getElementById('pwl-bulk-tbody');
    const table = document.getElementById('pwl-bulk-table');
    tbody.innerHTML = enrichedRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.contact.name || row.id)}</td>
          <td>${escapeHtml(row.emailResult?.verdict || '—')}</td>
          <td>${escapeHtml(row.phoneResult?.verdict || '—')}</td>
          <td>${escapeHtml(row.whatsappResult?.verdict || '—')}</td>
          <td>${escapeHtml(row.verdict.score)}</td>
          <td><span class="pwl-badge pwl-badge-${escapeHtml(row.verdict.status)}">${escapeHtml(row.verdict.status)}</span></td>
        </tr>`
      )
      .join('');
    table.hidden = false;

    let notesSaved = 0;
    if (typeof sdk.CRM.API.addNotes === 'function') {
      for (const row of enrichedRows) {
        if (!row.id) continue;
        try {
          await sdk.CRM.API.addNotes({
            Entity: moduleName,
            RecordID: row.id,
            Title: row.verdict.noteTitle,
            Content: row.verdict.noteContent,
          });
          notesSaved += 1;
        } catch (_err) {
          // Continue writing remaining notes if an individual record is locked.
        }
      }
    }

    setStatus(
      'pwl-bulk-status',
      `Completed ${enrichedRows.length} ${moduleName} verifications (${notesSaved} CRM notes attached).`,
      'info'
    );
  } catch (err) {
    setStatus('pwl-bulk-status', err?.message || 'Bulk enrichment failed.', 'error');
  } finally {
    runBtn.disabled = false;
  }
}

async function saveKeyAndCheckBalance() {
  const key = sanitizeApiKey(document.getElementById('pwl-api-key').value);
  const cc = sanitizeCountryCode(document.getElementById('pwl-default-country').value) || 'IN';
  if (!key) {
    setStatus('pwl-settings-status', 'Enter a valid ProWebLook API key.', 'error');
    return;
  }

  state.apiKey = key;
  state.defaultCountry = cc;
  document.getElementById('pwl-rec-country').value = cc;

  try {
    sessionStorage.setItem(STORAGE_KEY_API, key);
    sessionStorage.setItem(STORAGE_KEY_COUNTRY, cc);
  } catch (_err) {
    // Ignore sandboxed storage failure.
  }

  const sdk = getZohoSdk();
  if (sdk?.CRM?.API?.setOrgVariable) {
    try {
      await sdk.CRM.API.setOrgVariable({ apiname: 'proweblook__api_key', value: key });
      await sdk.CRM.API.setOrgVariable({ apiname: 'proweblook__default_country_code', value: cc });
    } catch (_err) {
      // Non-admin CRM users can still verify with sessionStorage key.
    }
  }

  setStatus('pwl-settings-status', 'Checking ProWebLook credit balances (0 credits)...', 'info');
  try {
    const balances = await callProweblookZoho('get_balance', {}, {
      apiKey: key,
      zohoHttp: getZohoHttp(),
    });
    const out = document.getElementById('pwl-balances-output');
    out.innerHTML = ['email', 'phone', 'whatsapp', 'caller']
      .map(
        (pool) => `<div class="pwl-signal-card">
          <strong>${escapeHtml(pool)} credits</strong>
          <span>${escapeHtml(balances?.[pool]?.amount ?? 0)}</span>
        </div>`
      )
      .join('');
    setStatus('pwl-settings-status', `Connected as ${balances.account_email || 'verified account'}.`, 'info');
  } catch (err) {
    setStatus('pwl-settings-status', err?.message || 'Could not validate API key.', 'error');
  }
}

function bootstrapUi() {
  const params = new URLSearchParams(globalThis.location?.search || '');
  if (params.get('mode') === 'bulk') {
    selectTab('bulk');
  }

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  document.getElementById('pwl-btn-verify')?.addEventListener('click', runSingleRecordVerification);
  document.getElementById('pwl-btn-save-crm')?.addEventListener('click', saveVerdictToZohoCrm);
  document.getElementById('pwl-btn-bulk-run')?.addEventListener('click', runBulkModuleEnrichment);
  document.getElementById('pwl-btn-save-key')?.addEventListener('click', saveKeyAndCheckBalance);

  const delugePreview = document.getElementById('pwl-deluge-preview');
  if (delugePreview) {
    delugePreview.textContent = ZOHO_CRM_DELUGE_SNIPPET;
  }

  document.querySelectorAll('[data-deluge-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.delugeCopy === 'bigin' ? ZOHO_BIGIN_DELUGE_SNIPPET : ZOHO_CRM_DELUGE_SNIPPET;
      if (delugePreview) delugePreview.textContent = code;
      try {
        await navigator.clipboard.writeText(code);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1600);
      } catch (_err) {
        // Preview updated in <pre> for manual copy if clipboard blocked.
      }
    });
  });

  const sdk = getZohoSdk();
  if (sdk?.embeddedApp) {
    sdk.embeddedApp.on('PageLoad', handlePageLoad);
    sdk.embeddedApp.init().then(loadOrgVariables).catch(() => loadOrgVariables());
  } else {
    loadOrgVariables();
  }
}

if (typeof document !== 'undefined') {
  bootstrapUi();
}
