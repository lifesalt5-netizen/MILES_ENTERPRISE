'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunPostSoakRemediationRetry.ps1'), 'utf8');
const cmd = fs.readFileSync(path.join(root, 'POST_SOAK_REMEDIATION_RETRY.cmd'), 'utf8');
const assist = fs.readFileSync(path.join(root, 'SERVICES', 'revenue', 'LinkedInProspectAssistService.js'), 'utf8');

assert(ps.includes("P2GC_NURTURE_EXECUTE = 'false'"), 'nurture must plan first');
assert(ps.includes('$due -eq 0'), 'nurture execution proof must require zero due actions');
assert(ps.includes("P2GC_ACQ_V2_EXECUTE = 'false'"), 'acquisition must plan first');
assert(ps.includes('$accepted -eq 0'), 'acquisition execution proof must require zero accepted leads');
assert(ps.includes("B12_PUBLISH_ENABLED = 'false'"), 'B12 public publish must be disabled');
assert(ps.includes('linkedinScraping = $false'), 'report must assert no LinkedIn scraping');
assert(ps.includes('automatedLinkedInConnections = $false'), 'report must assert no automated connections');
assert(ps.includes('automatedLinkedInDMs = $false'), 'report must assert no automated DMs');
assert(ps.includes("ForEach-Object { Write-Host ([string]$_) }"), 'node stdout must not contaminate returned exit code');
assert(cmd.includes('No new 24-hour soak'), 'launcher must state no new soak');
assert(assist.includes('publicWebSearchLinksOnly: true'), 'assist must use public web search links only');
assert(assist.includes('manualLinkedInActionRequired: true'), 'LinkedIn action must remain manual');
assert(assist.includes('automatedConnectionRequests: false'), 'automated connection requests must be disabled');
assert(assist.includes('automatedDirectMessages: false'), 'automated DMs must be disabled');

console.log('POST_SOAK_REMEDIATION_RETRY_CONTRACT=GREEN');
