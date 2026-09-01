'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Service = require('../SERVICES/teaming/PrimeSubcontractHistoryNetworkService');

function ok(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-sub2prime-'));
  const csvPath = path.join(dir, 'subawards.csv');
  fs.writeFileSync(csvPath, [
    'prime_award_recipient_name,prime_award_recipient_uei,prime_award_id,subaward_id,subawardee_name,subawardee_uei,subaward_amount,subaward_action_date,subaward_description,awarding_agency_name,naics_code,product_or_service_code',
    'BIG PRIME LLC,PRIMEUEI1,FAKE-001,SUB-001,CYBER SMALL LLC,SUBUEI1,125000,2026-01-15,Penetration testing support,Department of Defense,541512,D310',
    'BIG PRIME LLC,PRIMEUEI1,FAKE-001,SUB-002,DATA SMALL LLC,SUBUEI2,90000,2026-02-10,Data engineering support,Department of Defense,541511,D302',
    'BIG PRIME LLC,PRIMEUEI1,FAKE-002,SUB-003,CYBER SMALL LLC,SUBUEI1,50000,2026-03-01,Cybersecurity support,Department of Homeland Security,541512,D310'
  ].join('\n'), 'utf8');

  const service = new Service({ now: () => new Date('2026-08-31T22:30:00Z') });
  const result = await service.run({ csvFiles:[csvPath] });
  ok(result.ok === true, 'network should build');
  ok(result.status === 'HISTORICAL_NETWORK_READY', 'status should be ready');
  ok(result.counts.primes === 1, 'one prime expected');
  ok(result.counts.relationships === 3, 'three evidence relationships expected');
  ok(result.counts.uniqueSubcontractors === 2, 'two unique subcontractors expected');
  const prime = result.primes[0];
  ok(prime.prime.uei === 'PRIMEUEI1', 'prime UEI should survive');
  ok(prime.subcontractors.length === 2, 'prime should expose two historical subs');
  const cyber = prime.subcontractors.find(x => x.subcontractor.uei === 'SUBUEI1');
  ok(cyber && cyber.subawardCount === 2, 'historical sub usage should aggregate');
  ok(cyber.totalAmount === 175000, 'historical sub dollars should aggregate');
  ok(cyber.naics.includes('541512'), 'NAICS evidence should survive');
  ok(cyber.agencies.includes('Department of Defense') && cyber.agencies.includes('Department of Homeland Security'), 'agency evidence should survive');
  ok(cyber.confidence === 'HISTORICAL_SUBAWARD_EVIDENCE', 'historical evidence must be labeled');
  ok(result.safety.relationshipsInvented === false, 'relationships must never be invented');

  const blocked = await service.run({ csvFiles:[] });
  ok(blocked.ok === false && blocked.blocker === 'SUBAWARD_CSV_REQUIRED', 'missing evidence should fail closed');
  console.log('PRIME_SUBCONTRACT_HISTORY_NETWORK_TEST_PASS');
})().catch(error => { console.error(error); process.exit(1); });
