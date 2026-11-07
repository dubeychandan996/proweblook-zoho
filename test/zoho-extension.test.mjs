import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { callProweblookZoho, sanitizeApiKey, redactSecret } from '../app/js/api.js';
import {
  extractZohoRecordContact,
  shouldSkipVerifiedZohoRecord,
  compareCallerName,
  computeZohoTrustVerdict,
  enrichZohoContacts,
  chunkZohoUpdates,
} from '../app/js/enrichment.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('API client supports ZOHO.CRM.HTTP.post proxy, fetch fallback, and secret redaction', async () => {
  assert.equal(sanitizeApiKey('  valid_key-123  '), 'valid_key-123');
  assert.equal(sanitizeApiKey('bad key with spaces'), '');
  assert.equal(redactSecret('Failed with secret_abc123 in URL', 'secret_abc123'), 'Failed with [REDACTED] in URL');

  const proxyCalls = [];
  const zohoHttp = {
    async post(req) {
      proxyCalls.push(req);
      return JSON.stringify({
        ok: true,
        data: { email: 'priya@acme.in', verdict: 'deliverable', reason: 'deliverable' },
      });
    },
  };

  const data = await callProweblookZoho(
    'verify_email',
    { email: 'priya@acme.in' },
    { apiKey: 'secret_abc123', zohoHttp }
  );
  assert.equal(data.verdict, 'deliverable');
  assert.equal(proxyCalls.length, 1);
  assert.equal(proxyCalls[0].url, 'https://proweblook.com/api/v1/zoho/verify_email');
  assert.equal(proxyCalls[0].headers.Authorization, 'Bearer secret_abc123');

  await assert.rejects(
    () =>
      callProweblookZoho(
        'verify_email',
        { email: 'priya@acme.in' },
        {
          apiKey: 'secret_abc123',
          fetchImpl: async () => {
            throw new Error('Socket error for secret_abc123');
          },
        }
      ),
    (err) => !err.message.includes('secret_abc123') && err.message.includes('[REDACTED]')
  );
});

test('extractZohoRecordContact handles Zoho CRM Leads, Contacts, Deals, and country names', () => {
  const lead = {
    id: '592001928371',
    First_Name: 'Priya',
    Last_Name: 'Sharma',
    Email: 'priya@acme.in',
    Mobile: '9876543210',
    Country: 'India',
  };
  const extracted = extractZohoRecordContact(lead, 'US');
  assert.equal(extracted.name, 'Priya Sharma');
  assert.equal(extracted.email, 'priya@acme.in');
  assert.equal(extracted.phone, '9876543210');
  assert.equal(extracted.countryCode, 'IN');

  const deal = {
    id: '991122',
    Contact_Name: { name: 'Alex Rivera', id: '123' },
    Phone: '+14155552671',
  };
  const dealContact = extractZohoRecordContact(deal, 'US');
  assert.equal(dealContact.name, 'Alex Rivera');
  assert.equal(dealContact.phone, '+14155552671');
  assert.equal(dealContact.countryCode, 'US');
});

test('shouldSkipVerifiedZohoRecord prevents double charges while allowing error retries', () => {
  assert.equal(shouldSkipVerifiedZohoRecord({ PWL_Verification_Status: 'APPROVE' }), true);
  assert.equal(shouldSkipVerifiedZohoRecord({ PWL_Verification_Status: 'block' }), true);
  assert.equal(shouldSkipVerifiedZohoRecord({ PWL_Verification_Status: 'ERROR: timeout' }), false);
  assert.equal(shouldSkipVerifiedZohoRecord({ PWL_Verification_Status: '' }), false);
});

test('Caller ID fuzzy matching and composite 0-100 Trust Score / CRM tag logic', () => {
  assert.equal(compareCallerName('Priya Sharma', 'SHARMA PRIYA'), 'partial_match');
  assert.equal(compareCallerName('Priya Sharma', 'PRIYA SHARMA'), 'exact_match');
  assert.equal(compareCallerName('Priya Sharma', 'JOHN SMITH'), 'mismatch');

  const approved = computeZohoTrustVerdict({
    emailResult: { verdict: 'deliverable' },
    phoneResult: { verdict: 'valid', phone_number: '+919876543210', details: { line_type: 'Mobile', carrier: 'Airtel' } },
    whatsappResult: { verdict: 'on_whatsapp' },
    callerResult: { verdict: 'found', caller_name: 'PRIYA SHARMA' },
    leadName: 'Priya Sharma',
  });
  assert.equal(approved.status, 'APPROVE');
  assert.equal(approved.crmTag, 'PWL-Approved');
  assert.ok(approved.score >= 95);

  const reviewVoip = computeZohoTrustVerdict({
    emailResult: { verdict: 'deliverable' },
    phoneResult: { verdict: 'valid', details: { line_type: 'VoIP' } },
    whatsappResult: { verdict: 'not_on_whatsapp' },
  });
  assert.equal(reviewVoip.status, 'REVIEW');
  assert.equal(reviewVoip.crmTag, 'PWL-Review');

  const blocked = computeZohoTrustVerdict({
    emailResult: { verdict: 'undeliverable', reason: 'disposable' },
    phoneResult: { verdict: 'valid', details: { line_type: 'Mobile' } },
  });
  assert.equal(blocked.status, 'BLOCK');
  assert.equal(blocked.crmTag, 'PWL-Blocked');
});

test('enrichZohoContacts deduplicates contacts and short-circuits WhatsApp/CallerID on invalid phone', async () => {
  const calls = [];
  const mockCall = async (op, payload) => {
    calls.push([op, payload]);
    if (op === 'verify_email') return { email: payload.email, verdict: 'deliverable' };
    if (op === 'validate_phone') return { phone_number: '+1000000', verdict: 'invalid' };
    throw new Error(`Unexpected call: ${op}`);
  };

  const rows = await enrichZohoContacts(
    [
      { id: '1', name: 'Lead A', email: 'same@acme.com', phone: '000000', countryCode: 'US' },
      { id: '2', name: 'Lead A Dup', email: 'same@acme.com', phone: '000000', countryCode: 'US' },
    ],
    {
      apiKey: 'fixture-key',
      checks: { email: true, phone: true, whatsapp: true, callerId: true },
      callApi: mockCall,
    }
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].verdict.status, 'BLOCK');
  assert.equal(calls.length, 2, 'Deduplicated across both records and skipped WhatsApp/CallerID on invalid phone');
});

test('chunkZohoUpdates enforces Zoho CRM 100-record batch limit', () => {
  const items = Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1) }));
  const chunks = chunkZohoUpdates(items);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 100);
  assert.equal(chunks[1].length, 100);
  assert.equal(chunks[2].length, 5);
});

test('All JS modules pass node --check syntax validation and Deluge scripts target /api/v1/zoho', () => {
  for (const rel of [
    'app/js/api.js',
    'app/js/enrichment.js',
    'app/js/templates.js',
    'app/js/app.js',
    'scripts/validate-package.mjs',
    'scripts/package-zip.mjs',
  ]) {
    execFileSync(process.execPath, ['--check', path.join(root, rel)]);
  }

  for (const dgRel of ['deluge/verify_lead_workflow.dg', 'deluge/bigin_contact_verify.dg']) {
    const dg = fs.readFileSync(path.join(root, dgRel), 'utf8');
    assert.ok(dg.includes('https://proweblook.com/api/v1/zoho/verify_email'));
    assert.ok(dg.includes('https://proweblook.com/api/v1/zoho/validate_phone'));
    assert.ok(dg.includes('https://proweblook.com/api/v1/zoho/check_whatsapp'));
  }
});
