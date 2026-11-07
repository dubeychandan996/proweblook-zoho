import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const manifestPath = path.join(root, 'plugin-manifest.json');
assert(fs.existsSync(manifestPath), 'plugin-manifest.json must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert(manifest.service === 'CRM', 'plugin-manifest.json service must be CRM');
assert(Array.isArray(manifest.locale) && manifest.locale.includes('en'), 'plugin-manifest.json must declare en locale');
assert(
  Array.isArray(manifest.whiteListedDomains) &&
    manifest.whiteListedDomains.length === 1 &&
    manifest.whiteListedDomains[0] === 'https://proweblook.com',
  'whiteListedDomains must strictly allow https://proweblook.com'
);

const configVars = Array.isArray(manifest.config) ? manifest.config : [];
const apiKeyVar = configVars.find((c) => c.api_name === 'proweblook.api_key');
assert(apiKeyVar && apiKeyVar.secure === true && apiKeyVar.mandatory === true, 'proweblook.api_key org variable must be secure and mandatory');

const widgets = manifest.modules?.widgets || [];
assert(widgets.length === 4, 'plugin-manifest.json must register 4 Zoho CRM widgets (Leads, Contacts, Deals, WebTab)');
for (const widget of widgets) {
  const cleanUrl = widget.url.split('?')[0].replace(/^\/+/, '');
  assert(fs.existsSync(path.join(root, cleanUrl)), `Widget HTML missing: ${cleanUrl}`);
  const cleanLogo = widget.logo.replace(/^\/+/, '');
  assert(fs.existsSync(path.join(root, cleanLogo)), `Widget logo missing: ${cleanLogo}`);
}

assert(fs.existsSync(path.join(root, 'app/translations/en.json')), 'app/translations/en.json must exist for Zoho Sigma');
assert(fs.existsSync(path.join(root, 'deluge/verify_lead_workflow.dg')), 'deluge/verify_lead_workflow.dg must exist');
assert(fs.existsSync(path.join(root, 'deluge/bigin_contact_verify.dg')), 'deluge/bigin_contact_verify.dg must exist');

console.log('PASS: Zoho CRM & Bigin Marketplace Extension package validated.');
