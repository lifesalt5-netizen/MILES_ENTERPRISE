'use strict';

const assert = require('assert');
const service = require('../SERVICES/revenue/AwardHistoryLocalInventoryService');

assert.deepStrictEqual(service.yearHits('FY2025_All_Contracts_Full.zip'), [2025]);
assert.deepStrictEqual(service.yearHits('prime_subaward_2021_2022.csv'), [2021, 2022]);
assert.strictEqual(service.candidateFile('D:/P2GC_Intelligence/AWARDS/FY2024_All_Contracts_Full.zip'), true);
assert.strictEqual(service.candidateFile('D:/P2GC_Intelligence/archive/2023_contractors.sqlite'), true);
assert.strictEqual(service.candidateFile('D:/P2GC_Intelligence/images/2025_photo.png'), false);
assert.strictEqual(service.candidateFile('D:/P2GC_Intelligence/random/readme.txt'), false);

console.log('AWARD_HISTORY_LOCAL_INVENTORY_TEST=GREEN');
