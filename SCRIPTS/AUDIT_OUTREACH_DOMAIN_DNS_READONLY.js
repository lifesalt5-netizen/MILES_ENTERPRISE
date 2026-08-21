'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const DOMAINS = [
  'pathways2gc.co',
  'pathwaysfederal.com',
  'pathwaysgov.com',
  'pathwaysgovcon.com',
  'pathwaysgsa.com',
  'pathwaystogc.com'
];
const DKIM_SELECTORS = ['google','default','selector1','selector2','s1','s2','k1'];

async function safe(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.code || e.message || String(e) }; }
}

function txtStrings(rows) {
  return (rows || []).map(parts => Array.isArray(parts) ? parts.join('') : String(parts));
}

async function auditDomain(domain) {
  const mx = await safe(() => dns.resolveMx(domain));
  const txt = await safe(() => dns.resolveTxt(domain));
  const dmarc = await safe(() => dns.resolveTxt(`_dmarc.${domain}`));

  const rootTxt = txt.ok ? txtStrings(txt.value) : [];
  const dmarcTxt = dmarc.ok ? txtStrings(dmarc.value) : [];
  const spf = rootTxt.filter(v => /^v=spf1\b/i.test(v));
  const dmarcRecords = dmarcTxt.filter(v => /^v=DMARC1\b/i.test(v));

  const dkim = [];
  for (const selector of DKIM_SELECTORS) {
    const r = await safe(() => dns.resolveTxt(`${selector}._domainkey.${domain}`));
    if (r.ok) {
      const values = txtStrings(r.value).filter(v => /\bv=DKIM1\b|\bp=/i.test(v));
      if (values.length) dkim.push({ selector, records: values });
    }
  }

  const mxRows = mx.ok ? mx.value : [];
  const googleMx = mxRows.filter(r => /google\.com\.?$/i.test(r.exchange || ''));

  return {
    domain,
    mx: { ok: mx.ok, records: mxRows, error: mx.error || null, googleWorkspaceLike: googleMx.length > 0 },
    spf: { ok: spf.length === 1, records: spf, count: spf.length, note: spf.length === 0 ? 'NO_SPF_FOUND' : spf.length > 1 ? 'MULTIPLE_SPF_RECORDS_FOUND' : 'ONE_SPF_RECORD_FOUND' },
    dmarc: { ok: dmarcRecords.length === 1, records: dmarcRecords, count: dmarcRecords.length, note: dmarcRecords.length === 0 ? 'NO_DMARC_FOUND' : dmarcRecords.length > 1 ? 'MULTIPLE_DMARC_RECORDS_FOUND' : 'ONE_DMARC_RECORD_FOUND' },
    dkim: { candidateSelectorsChecked: DKIM_SELECTORS, discovered: dkim, note: dkim.length ? 'DKIM_RECORD_FOUND_ON_CHECKED_SELECTOR' : 'NO_DKIM_FOUND_ON_COMMON_SELECTORS_SELECTOR_MAY_DIFFER' }
  };
}

(async () => {
  const domains = [];
  for (const domain of DOMAINS) domains.push(await auditDomain(domain));
  const report = {
    ok: true,
    gate: 'OUTREACH_DOMAIN_DNS_READ_ONLY_AUDIT',
    mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(),
    domains,
    safety: { externalWritesPerformed: false, dnsMutated: false, mailboxesMutated: false, instantlyMutated: false }
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'DOMAIN_DNS_AUDIT');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'OUTREACH_DOMAIN_DNS_AUDIT_LATEST.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log('============================================================');
  console.log('MILES OUTREACH DOMAIN DNS AUDIT - READ ONLY');
  console.log('============================================================');
  for (const d of domains) {
    console.log(`${d.domain}: MX=${d.mx.records.length} googleMX=${d.mx.googleWorkspaceLike} SPF=${d.spf.count} DMARC=${d.dmarc.count} DKIM_DISCOVERED=${d.dkim.discovered.length}`);
  }
  console.log('External writes performed: False');
  console.log(`Report: ${out}`);
})().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
