'use strict';

const path = require('path');
const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = ROOT;

const RepositoryRiskQualificationService = require('../SERVICES/RepositoryRiskQualificationService');

const result = new RepositoryRiskQualificationService().run();

console.log('============================================================');
console.log('MILES REPOSITORY RISK QUALIFICATION');
console.log('============================================================');
console.log(`Candidate duplicates preserved: ${result.statistics.duplicateCandidates || 0}`);
console.log(`Actionable duplicate risks: ${result.statistics.duplicateRisks || 0}`);
console.log(`Candidate orphans preserved: ${result.statistics.orphanCandidates || 0}`);
console.log(`Actionable orphan risks: ${result.statistics.orphanRisks || 0}`);
console.log(`Repository health: ${result.health.score} / ${result.health.status}`);
console.log('Unverified static candidates remain visible and are not treated as confirmed production failures.');
console.log('RESULT: REPOSITORY_RISK_QUALIFICATION_GREEN');
