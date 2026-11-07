import { callProweblookZoho, sanitizeCountryCode } from './api.js';

const COUNTRY_NAME_TO_ISO2 = Object.freeze({
  INDIA: 'IN',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  USA: 'US',
  'UNITED KINGDOM': 'GB',
  UK: 'GB',
  CANADA: 'CA',
  AUSTRALIA: 'AU',
  SINGAPORE: 'SG',
  'UNITED ARAB EMIRATES': 'AE',
  UAE: 'AE',
  GERMANY: 'DE',
  FRANCE: 'FR',
  BRAZIL: 'BR',
  MEXICO: 'MX',
  INDONESIA: 'ID',
  NIGERIA: 'NG',
  'SOUTH AFRICA': 'ZA',
  'SAUDI ARABIA': 'SA',
  JAPAN: 'JP',
});

export function resolveIsoCountry(rawCountry, fallbackIso = 'US') {
  const fallback = sanitizeCountryCode(fallbackIso) || 'US';
  if (typeof rawCountry !== 'string' || !rawCountry.trim()) return fallback;
  const clean = rawCountry.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(clean)) return clean;
  return COUNTRY_NAME_TO_ISO2[clean] || fallback;
}

export function extractPlainText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractPlainText(item);
      if (extracted) return extracted;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
    if (typeof value.Full_Name === 'string' && value.Full_Name.trim()) return value.Full_Name.trim();
    if (typeof value.email === 'string' && value.email.trim()) return value.email.trim();
    if (typeof value.value === 'string' && value.value.trim()) return value.value.trim();
  }
  return '';
}

export function extractZohoRecordContact(record = {}, defaultCountry = 'US') {
  const fullName =
    extractPlainText(record.Full_Name) ||
    [extractPlainText(record.First_Name), extractPlainText(record.Last_Name)].filter(Boolean).join(' ').trim() ||
    extractPlainText(record.Contact_Name) ||
    extractPlainText(record.Deal_Name) ||
    extractPlainText(record.Account_Name);

  const email =
    extractPlainText(record.Email) ||
    extractPlainText(record.Secondary_Email);

  const phone =
    extractPlainText(record.Mobile) ||
    extractPlainText(record.Phone) ||
    extractPlainText(record.Home_Phone) ||
    extractPlainText(record.Other_Phone);

  const rawCountry =
    extractPlainText(record.Country) ||
    extractPlainText(record.Mailing_Country) ||
    extractPlainText(record.Billing_Country);

  const countryCode = resolveIsoCountry(rawCountry, defaultCountry);

  return {
    id: extractPlainText(record.id),
    name: fullName,
    email,
    phone,
    countryCode,
  };
}

export function shouldSkipVerifiedZohoRecord(record = {}, statusField = 'PWL_Verification_Status') {
  const existing = extractPlainText(record[statusField]).toUpperCase();
  if (!existing) return false;
  if (existing.includes('ERROR') || existing.includes('FAILED') || existing === 'PENDING') {
    return false;
  }
  return ['APPROVE', 'REVIEW', 'BLOCK', 'VERIFIED', 'DELIVERABLE', 'UNDELIVERABLE'].includes(existing);
}

export function normalizeNameTokens(name) {
  if (typeof name !== 'string') return [];
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !['mr', 'ms', 'mrs', 'dr', 'shri', 'smt', 'inc', 'llc', 'ltd', 'pvt'].includes(token));
}

export function compareCallerName(leadName, callerName) {
  const leadTokens = normalizeNameTokens(leadName);
  const callerTokens = normalizeNameTokens(callerName);
  if (!leadTokens.length || !callerTokens.length) return 'not_applicable';

  if (leadTokens.join(' ') === callerTokens.join(' ')) return 'exact_match';

  const overlap = leadTokens.filter((token) =>
    callerTokens.some((cToken) => cToken === token || (token.length >= 4 && cToken.startsWith(token)) || (cToken.length >= 4 && token.startsWith(cToken)))
  );
  if (overlap.length >= 1) return 'partial_match';
  return 'mismatch';
}

export function computeZohoTrustVerdict({
  emailResult = null,
  phoneResult = null,
  whatsappResult = null,
  callerResult = null,
  leadName = '',
} = {}) {
  let score = 50;
  let hardBlock = false;
  const reasons = [];

  if (emailResult) {
    if (emailResult.verdict === 'deliverable') {
      score += 20;
      reasons.push('Email deliverable (+20)');
    } else if (emailResult.verdict === 'unknown') {
      score -= 5;
      reasons.push('Email catch-all/unknown (-5)');
    } else if (emailResult.verdict === 'undeliverable') {
      score -= 35;
      hardBlock = true;
      reasons.push(`Email undeliverable: ${emailResult.reason || 'rejected'} (-35)`);
    }
  }

  if (phoneResult) {
    const lineType = String(
      phoneResult.details?.line_type || phoneResult.details?.linetype || ''
    ).toLowerCase();

    if (phoneResult.verdict === 'valid') {
      score += 15;
      reasons.push('Phone valid (+15)');
      if (lineType.includes('voip') || lineType.includes('virtual')) {
        score -= 20;
        reasons.push('VoIP/virtual carrier (-20)');
      } else if (lineType.includes('mobile') || lineType.includes('cell')) {
        score += 5;
        reasons.push('Mobile line (+5)');
      }
    } else if (phoneResult.verdict === 'invalid') {
      score -= 35;
      hardBlock = true;
      reasons.push('Phone invalid (-35)');
    }
  }

  if (whatsappResult) {
    if (whatsappResult.verdict === 'on_whatsapp') {
      score += 15;
      reasons.push('Active on WhatsApp (+15)');
    } else if (whatsappResult.verdict === 'not_on_whatsapp') {
      score -= 12;
      reasons.push('Not registered on WhatsApp (-12)');
    }
  }

  let callerMatch = 'not_applicable';
  if (callerResult && callerResult.verdict === 'found' && callerResult.caller_name) {
    callerMatch = compareCallerName(leadName, callerResult.caller_name);
    if (callerMatch === 'exact_match') {
      score += 10;
      reasons.push(`Caller ID matches "${callerResult.caller_name}" (+10)`);
    } else if (callerMatch === 'partial_match') {
      score += 5;
      reasons.push(`Caller ID partial match "${callerResult.caller_name}" (+5)`);
    } else if (callerMatch === 'mismatch') {
      score -= 10;
      reasons.push(`Caller ID name mismatch "${callerResult.caller_name}" (-10)`);
    }
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const status = hardBlock || boundedScore < 35
    ? 'BLOCK'
    : boundedScore >= 70
      ? 'APPROVE'
      : 'REVIEW';

  const crmTag = status === 'APPROVE'
    ? 'PWL-Approved'
    : status === 'BLOCK'
      ? 'PWL-Blocked'
      : 'PWL-Review';

  const noteLines = [
    `ProWebLook Verification: ${status} (Trust Score: ${boundedScore}/100)`,
    emailResult ? `- Email: ${emailResult.verdict} (${emailResult.reason || 'checked'})` : null,
    phoneResult
      ? `- Phone: ${phoneResult.verdict} (${phoneResult.phone_number || ''}${phoneResult.details?.carrier ? ` · ${phoneResult.details.carrier}` : ''}${phoneResult.details?.line_type || phoneResult.details?.linetype ? ` · ${phoneResult.details.line_type || phoneResult.details.linetype}` : ''})`
      : null,
    whatsappResult ? `- Silent WhatsApp: ${whatsappResult.verdict}` : null,
    callerResult && callerResult.caller_name
      ? `- Caller ID (CNAM): ${callerResult.caller_name} (${callerMatch})`
      : null,
    reasons.length ? `- Signals: ${reasons.join('; ')}` : null,
  ].filter(Boolean);

  return {
    score: boundedScore,
    status,
    crmTag,
    callerMatch,
    reasons,
    noteTitle: `ProWebLook ${status} (${boundedScore}/100)`,
    noteContent: noteLines.join('\n'),
  };
}

export function buildPhonePayload(rawPhone, defaultCountry = 'US') {
  const trimmed = String(rawPhone || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) {
    return { phone_number: trimmed };
  }
  const cc = sanitizeCountryCode(defaultCountry) || 'US';
  return { phone_number: trimmed, country_code: cc };
}

/**
 * Enriches one or many Zoho CRM / Bigin contact objects with session-level
 * deduplication and automatic invalid-phone short-circuiting so credits are
 * never wasted on unreachable numbers.
 */
export async function enrichZohoContacts(contacts, options = {}) {
  const {
    apiKey,
    defaultCountry = 'US',
    checks = { email: true, phone: true, whatsapp: true, callerId: false },
    callApi = callProweblookZoho,
    cache = new Map(),
    onProgress = null,
  } = options;

  const results = [];

  async function cachedCall(op, payload) {
    const cacheKey = `${op}:${JSON.stringify(payload)}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const data = await callApi(op, payload, {
      apiKey,
      zohoHttp: options.zohoHttp,
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
    });
    cache.set(cacheKey, data);
    return data;
  }

  for (let i = 0; i < contacts.length; i += 1) {
    const contact = contacts[i];
    const cc = contact.countryCode || defaultCountry;

    let emailResult = null;
    let phoneResult = null;
    let whatsappResult = null;
    let callerResult = null;

    if (checks.email && contact.email) {
      emailResult = await cachedCall('verify_email', { email: contact.email });
    }

    const phonePayload = contact.phone ? buildPhonePayload(contact.phone, cc) : null;
    if (checks.phone && phonePayload) {
      phoneResult = await cachedCall('validate_phone', phonePayload);
    }

    const phoneIsInvalid = phoneResult && phoneResult.verdict === 'invalid';
    const normalizedPhonePayload = phoneResult?.phone_number
      ? { phone_number: phoneResult.phone_number }
      : phonePayload;

    if (!phoneIsInvalid && normalizedPhonePayload) {
      if (checks.whatsapp) {
        whatsappResult = await cachedCall('check_whatsapp', normalizedPhonePayload);
      }
      if (checks.callerId) {
        callerResult = await cachedCall('caller_id', normalizedPhonePayload);
      }
    }

    const verdict = computeZohoTrustVerdict({
      emailResult,
      phoneResult,
      whatsappResult,
      callerResult,
      leadName: contact.name || '',
    });

    const enriched = {
      id: contact.id || '',
      contact,
      emailResult,
      phoneResult,
      whatsappResult,
      callerResult,
      verdict,
    };
    results.push(enriched);

    if (typeof onProgress === 'function') {
      onProgress({ completed: i + 1, total: contacts.length, current: enriched });
    }
  }

  return results;
}

/**
 * Zoho CRM REST / JS SDK `updateRecord` accepts up to 100 records per batch call.
 */
export function chunkZohoUpdates(updates, batchSize = 100) {
  const size = Math.max(1, Math.min(100, Number(batchSize) || 100));
  const chunks = [];
  for (let i = 0; i < updates.length; i += size) {
    chunks.push(updates.slice(i, i + size));
  }
  return chunks;
}
