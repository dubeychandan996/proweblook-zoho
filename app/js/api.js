export const ZOHO_API_BASE = 'https://proweblook.com/api/v1/zoho';

export const SUPPORTED_OPERATIONS = Object.freeze([
  'get_balance',
  'verify_email',
  'validate_phone',
  'check_whatsapp',
  'caller_id',
]);

export function sanitizeApiKey(rawKey) {
  if (typeof rawKey !== 'string') return '';
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.length > 255) return '';
  if (!/^[A-Za-z0-9._~+/=-]{1,255}$/.test(trimmed)) return '';
  return trimmed;
}

export function sanitizeCountryCode(rawCountry) {
  if (typeof rawCountry !== 'string') return '';
  const clean = rawCountry.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(clean) ? clean : '';
}

export function redactSecret(text, secret) {
  const safeText = String(text || 'Request failed');
  if (!secret || typeof secret !== 'string' || secret.length < 4) {
    return safeText;
  }
  return safeText.split(secret).join('[REDACTED]');
}

/**
 * Calls POST https://proweblook.com/api/v1/zoho/{operation}.
 * Prefers Zoho CRM's server-side proxy (`zohoHttp.post`) when running inside an
 * embedded Zoho CRM widget so browser CORS/adblockers never interfere, and falls
 * back cleanly to standard `fetch` in standalone tests or custom browser views.
 */
export async function callProweblookZoho(operation, payload = {}, options = {}) {
  if (!SUPPORTED_OPERATIONS.includes(operation)) {
    throw new Error(`Unsupported ProWebLook Zoho operation: ${operation}`);
  }

  const apiKey = sanitizeApiKey(options.apiKey);
  if (!apiKey) {
    const err = new Error('Enter a valid ProWebLook API key in Credits & Key settings.');
    err.code = 'invalid_credentials';
    throw err;
  }

  const endpointBase = String(options.baseUrl || ZOHO_API_BASE).replace(/\/+$/, '');
  const url = `${endpointBase}/${operation}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const cleanPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const bodyString = JSON.stringify(cleanPayload);

  let status = 200;
  let parsed = null;

  if (options.zohoHttp && typeof options.zohoHttp.post === 'function') {
    const rawResp = await options.zohoHttp.post({
      url,
      headers,
      body: cleanPayload,
    });
    if (typeof rawResp === 'string') {
      try {
        parsed = JSON.parse(rawResp);
      } catch (_err) {
        parsed = null;
      }
    } else if (rawResp && typeof rawResp === 'object') {
      if (typeof rawResp.status_code === 'number') status = rawResp.status_code;
      if (typeof rawResp.response === 'string') {
        try {
          parsed = JSON.parse(rawResp.response);
        } catch (_err) {
          parsed = null;
        }
      } else {
        parsed = rawResp;
      }
    }
  } else {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('No HTTP transport available (expected ZOHO.CRM.HTTP.post or fetch).');
    }
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: bodyString,
      });
    } catch (networkErr) {
      const err = new Error(redactSecret(networkErr?.message || 'Network error contacting ProWebLook.', apiKey));
      err.code = 'network_error';
      throw err;
    }
    status = res.status;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_err) {
      parsed = null;
    }
  }

  if (!parsed || parsed.ok !== true || status >= 400) {
    const code = parsed?.error?.code || (status === 401 ? 'invalid_credentials' : 'service_unavailable');
    const message = redactSecret(
      parsed?.error?.message || `ProWebLook returned HTTP ${status}.`,
      apiKey
    );
    const err = new Error(message);
    err.code = code;
    err.status = status;
    throw err;
  }

  return parsed.data;
}
