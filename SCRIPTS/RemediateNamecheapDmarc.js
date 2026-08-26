'use strict';

const https = require('https');
const { URLSearchParams } = require('url');
const { promises: dns } = require('dns');

const TARGET_DOMAIN = 'pathwaysgovcon.com';
const TARGET_HOST = '_dmarc';
const TARGET_VALUE = 'v=DMARC1; p=none';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

function splitDomain(domain) {
  const parts = String(domain).toLowerCase().split('.');
  if (parts.length !== 2) throw new Error('ONLY_SIMPLE_APEX_DOMAIN_SUPPORTED');
  return { sld: parts[0], tld: parts[1] };
}

function xmlDecode(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseHosts(xml) {
  const hosts = [];
  const re = /<host\s+([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const are = /(\w+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(m[1]))) attrs[a[1]] = xmlDecode(a[2]);
    hosts.push(attrs);
  }
  return hosts;
}

function apiCall(command, extra) {
  const apiUser = requireEnv('NAMECHEAP_API_USER');
  const apiKey = requireEnv('NAMECHEAP_API_KEY');
  const userName = process.env.NAMECHEAP_USERNAME || apiUser;
  const clientIp = requireEnv('NAMECHEAP_CLIENT_IP');
  const params = new URLSearchParams({ ApiUser: apiUser, ApiKey: apiKey, UserName: userName, ClientIp: clientIp, Command: command, ...extra });
  const url = `https://api.namecheap.com/xml.response?${params.toString()}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP_${res.statusCode}`));
        if (/Status="ERROR"/i.test(body)) {
          const msg = [...body.matchAll(/<Error[^>]*>(.*?)<\/Error>/g)].map(x => xmlDecode(x[1])).join(' | ');
          return reject(new Error(`NAMECHEAP_API_ERROR:${msg || 'UNKNOWN'}`));
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

function normalizeExisting(host) {
  return {
    Name: host.Name || host.name || '',
    Type: String(host.Type || host.type || '').toUpperCase(),
    Address: host.Address || host.address || '',
    TTL: host.TTL || host.ttl || '1800',
    MXPref: host.MXPref || host.mxpref || '10'
  };
}

function buildDesiredHosts(existing) {
  const normalized = existing.map(normalizeExisting);
  const matches = normalized.filter(h => h.Name.toLowerCase() === TARGET_HOST && h.Type === 'TXT');
  if (matches.length > 1) throw new Error('MULTIPLE_DMARC_TXT_RECORDS_FOUND');
  if (matches.length === 1) matches[0].Address = TARGET_VALUE;
  else normalized.push({ Name: TARGET_HOST, Type: 'TXT', Address: TARGET_VALUE, TTL: '1800', MXPref: '10' });
  return normalized;
}

function toSetHostsParams(hosts, sld, tld) {
  const params = { SLD: sld, TLD: tld };
  hosts.forEach((h, i) => {
    const n = i + 1;
    params[`HostName${n}`] = h.Name;
    params[`RecordType${n}`] = h.Type;
    params[`Address${n}`] = h.Address;
    params[`TTL${n}`] = String(h.TTL || 1800);
    if (h.Type === 'MX' || h.Type === 'MXE') params[`MXPref${n}`] = String(h.MXPref || 10);
  });
  return params;
}

async function publicDmarc() {
  try {
    const rows = await dns.resolveTxt(`_dmarc.${TARGET_DOMAIN}`);
    return rows.map(x => x.join(''));
  } catch (e) {
    return [];
  }
}

async function main() {
  const execute = process.argv.includes('--execute');
  const { sld, tld } = splitDomain(TARGET_DOMAIN);
  console.log('============================================================');
  console.log('P2GC NAMECHEAP GUARDED DMARC REMEDIATION');
  console.log('============================================================');
  console.log(`Domain: ${TARGET_DOMAIN}`);
  console.log(`Desired: ${TARGET_HOST} TXT ${TARGET_VALUE}`);

  const beforeXml = await apiCall('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  const before = parseHosts(beforeXml);
  if (!before.length) throw new Error('NO_EXISTING_DNS_HOSTS_RETURNED_REFUSING_SET_HOSTS');
  const desired = buildDesiredHosts(before);
  console.log(`Existing records preserved: ${before.length}`);
  console.log(`Desired records total: ${desired.length}`);

  if (!execute) {
    console.log('Mutation: NO (plan only)');
    console.log('RESULT: NAMECHEAP_DMARC_PLAN_READY');
    return;
  }

  await apiCall('namecheap.domains.dns.setHosts', toSetHostsParams(desired, sld, tld));
  const afterXml = await apiCall('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  const after = parseHosts(afterXml).map(normalizeExisting);
  const dmarc = after.filter(h => h.Name.toLowerCase() === TARGET_HOST && h.Type === 'TXT');
  const preserved = before.map(normalizeExisting).filter(h => !(h.Name.toLowerCase() === TARGET_HOST && h.Type === 'TXT')).every(h =>
    after.some(a => a.Name === h.Name && a.Type === h.Type && a.Address === h.Address)
  );
  console.log(`Namecheap read-back DMARC: ${dmarc.map(x => x.Address).join(' | ') || 'MISSING'}`);
  console.log(`Existing non-DMARC records preserved: ${preserved ? 'YES' : 'NO'}`);
  const publicRows = await publicDmarc();
  console.log(`Public DNS immediate read-back: ${publicRows.join(' | ') || 'NOT_PROPAGATED_YET'}`);

  if (dmarc.length === 1 && dmarc[0].Address === TARGET_VALUE && preserved) {
    console.log('RESULT: NAMECHEAP_DMARC_REMEDIATION_PROVIDER_READBACK_GREEN');
  } else {
    process.exitCode = 2;
    console.log('RESULT: NAMECHEAP_DMARC_REMEDIATION_RED');
  }
}

if (require.main === module) main().catch(e => { console.error(String(e.message || e)); process.exitCode = 1; });
module.exports = { splitDomain, parseHosts, buildDesiredHosts, toSetHostsParams };
