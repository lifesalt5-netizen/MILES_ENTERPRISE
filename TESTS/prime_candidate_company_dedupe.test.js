'use strict';

const assert = require('assert');
const PrimeCandidateDiscoveryService = require('../SERVICES/demo/PrimeCandidateDiscoveryService');

const rows = [
  { company:'LEIDOS, INC.', uei:'UEI-LOW', fitScore:80, federalRevenue:100 },
  { company:'Leidos Inc', uei:'UEI-HIGH', fitScore:90, federalRevenue:200 },
  { company:'LEIDOS INC.', uei:'UEI-TIE', fitScore:90, federalRevenue:150 },
  { company:'Other Prime LLC', uei:'OTHER-1', fitScore:70, federalRevenue:50 }
];

const deduped = PrimeCandidateDiscoveryService.dedupeCompanies(rows);
assert.strictEqual(deduped.length, 2, 'same normalized legal company must appear once');
assert.strictEqual(deduped.filter(row => PrimeCandidateDiscoveryService.normCompany(row.company) === 'LEIDOS INC').length, 1);
assert.strictEqual(deduped.find(row => PrimeCandidateDiscoveryService.normCompany(row.company) === 'LEIDOS INC').uei, 'UEI-HIGH', 'strongest evidence row must survive');
assert.strictEqual(deduped[0].uei, 'UEI-HIGH', 'results remain ordered by fit/evidence strength');

console.log('PRIME_CANDIDATE_COMPANY_DEDUPE=PASS');
