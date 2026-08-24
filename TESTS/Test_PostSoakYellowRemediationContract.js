'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunPostSoakYellowRemediation.ps1'), 'utf8');
const cmd = fs.readFileSync(path.join(root, 'POST_SOAK_YELLOW_REMEDIATION.cmd'), 'utf8');
const monica = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunMonicaPhase1HarvestMeasurement.js'), 'utf8');

assert(ps.includes("P2GC_NURTURE_EXECUTE = 'false'"), 'nurture must plan before execution');
assert(ps.includes('$due -eq 0'), 'nurture execute must be limited to zero due actions');
assert(ps.includes("P2GC_ACQ_V2_EXECUTE = 'false'"), 'pilot must plan before execution');
assert(ps.includes('$accepted -eq 0'), 'pilot execute must be limited to zero accepted leads');
assert(ps.includes("B12_PUBLISH_ENABLED = 'false'"), 'public B12 publishing must remain disabled');
assert(ps.includes("P2GC_LINKEDIN_PUBLISH = 'false'"), 'LinkedIn publishing must remain disabled');
assert(ps.includes("another24hSoakStarted = $false"), 'runner must record that no soak was started');
assert(ps.includes("monicaOutreachExecuted = $false"), 'MONICA outreach must remain blocked');
assert(cmd.includes('does NOT start another 24-hour soak'), 'launcher must state no new soak');
assert(cmd.includes('does NOT publish B12 publicly'), 'launcher must state no B12 public publish');
assert(cmd.includes('does NOT publish LinkedIn'), 'launcher must state no LinkedIn publish');
assert(monica.includes("mode: 'DISCOVERY_ONLY'"), 'MONICA measurement must remain DISCOVERY_ONLY');
assert(monica.includes('outreachBlocked: true'), 'MONICA measurement must block outreach');
assert(monica.includes('campaignEnrollmentBlocked: true'), 'MONICA measurement must block campaign enrollment');
assert(monica.includes('MONICA_PROVENANCE_REQUIRED') === false, 'runner should rely on canonical candidate service for provenance enforcement rather than weakening it');
assert(monica.includes('service.measure(rows)'), 'runner must use canonical MonicaDiscoveryCandidateService measurement');

console.log('POST_SOAK_YELLOW_REMEDIATION_CONTRACT=GREEN');
