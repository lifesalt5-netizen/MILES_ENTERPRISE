'use strict';
const assert = require('assert');
const { splitDomain, buildDesiredHosts, toSetHostsParams } = require('../SCRIPTS/RemediateNamecheapDmarc');

const { sld, tld } = splitDomain('pathwaysgovcon.com');
assert.strictEqual(sld, 'pathwaysgovcon');
assert.strictEqual(tld, 'com');

const before = [
  { Name: '@', Type: 'TXT', Address: 'v=spf1 include:_spf.google.com ~all', TTL: '1800' },
  { Name: '@', Type: 'MX', Address: 'aspmx.l.google.com', MXPref: '1', TTL: '1800' },
  { Name: 'google', Type: 'CNAME', Address: 'example.googlehosted.com.', TTL: '1800' }
];
const desired = buildDesiredHosts(before);
assert.strictEqual(desired.length, 4);
assert(desired.some(h => h.Name === '_dmarc' && h.Type === 'TXT' && h.Address === 'v=DMARC1; p=none'));
for (const h of before) assert(desired.some(x => x.Name === h.Name && x.Type === h.Type && x.Address === h.Address));

const params = toSetHostsParams(desired, sld, tld);
assert.strictEqual(params.SLD, 'pathwaysgovcon');
assert.strictEqual(params.TLD, 'com');
assert(Object.values(params).includes('_dmarc'));
assert(Object.values(params).includes('v=DMARC1; p=none'));

assert.throws(() => buildDesiredHosts([
  { Name: '_dmarc', Type: 'TXT', Address: 'v=DMARC1; p=none' },
  { Name: '_dmarc', Type: 'TXT', Address: 'v=DMARC1; p=quarantine' }
]), /MULTIPLE_DMARC_TXT_RECORDS_FOUND/);

console.log('NAMECHEAP_DMARC_REMEDIATION_TEST=GREEN');
