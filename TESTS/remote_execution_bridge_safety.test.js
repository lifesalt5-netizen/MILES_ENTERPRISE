'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bridge = require('../StartMilesRemoteExecutionBridge');

assert.deepStrictEqual(Object.keys(bridge.JOBS).sort(), [
  'CONTROL_OWNER_WATCHDOG_ENSURE',
  'CONTROL_OWNER_WATCHDOG_INSTALL',
  'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE',
  'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY',
  'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY',
  'COO_RUNTIME_APPROVAL_AUDIT',
  'FEDERAL_SOURCE_READINESS_AUDIT',
  'FY2026_AWARDED_UNIVERSE_COVERAGE',
  'INBOX_PLACEMENT_AUDIT',
  'INBOX_PLACEMENT_CREATE_FRESH',
  'INFRASTRUCTURE_HEALTH_AUDIT',
  'INSTANTLY_LIFECYCLE_PROOF_EXECUTE',
  'INSTANTLY_LIFECYCLE_PROOF_PLAN',
  'INSTANTLY_ZERO_COST_OAUTH_INIT_MISSING',
  'IONOS_INBOX_CLEANUP_EXECUTE',
  'IONOS_INBOX_CLEANUP_PLAN',
  'IONOS_SPAM_RESCUE_EXECUTE',
  'IONOS_SPAM_RESCUE_PLAN',
  'ORION_CONTRACT_SIDECAR_BUILD',
  'ORION_OFFICIAL_ARCHIVE_INSPECTION',
  'ORION_OFFICIAL_SOURCE_ACQUIRE_STAGING',
  'ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN',
  'ORION_REFRESH_TARGET_SCHEMA_AUDIT',
  'PRODUCTION_TRUTH_RECONCILIATION',
  'REVENUE_ACCEPTANCE_LATEST_PLACEMENT',
  'REVENUE_ACCEPTANCE_SPRINT',
  'REVENUE_UNIVERSE_RECONCILIATION',
  'SAM_BULK_EXTRACT_ACQUIRE_STAGING',
  'SAM_BULK_SCHEMA_AUDIT',
  'SAM_CONTACT_RECOVERY_SOURCE_AUDIT',
  'SAM_CURRENT_SEND_COLLISION_AUDIT',
  'SAM_EMAIL_RECOVERY',
  'SAM_PUBLIC_EMAIL_DISCOVERY',
  'SAM_QUALIFIED_UNIVERSE_BUILD',
  'SAM_SQLITE_EMAIL_RECOVERY',
  'SIX_FY_AWARDED_UNIVERSE_NORMALIZE'
]);
assert.deepStrictEqual(bridge.JOBS.REVENUE_UNIVERSE_RECONCILIATION, ['node', ['SCRIPTS/RunRevenueUniverseReconciliation.js']]);
assert.deepStrictEqual(bridge.JOBS.FY2026_AWARDED_UNIVERSE_COVERAGE, ['node', ['SCRIPTS/RunFy2026AwardedUniverseCoverage.js']]);
assert.deepStrictEqual(bridge.JOBS.SIX_FY_AWARDED_UNIVERSE_NORMALIZE, ['node', ['SCRIPTS/RunSixFiscalYearAwardUniverseNormalization.js']]);
assert.deepStrictEqual(bridge.JOBS.INFRASTRUCTURE_HEALTH_AUDIT, ['node', ['SCRIPTS/RunInfrastructureHealthAudit.js']]);
assert.deepStrictEqual(bridge.JOBS.COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY, ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]);
assert.deepStrictEqual(bridge.JOBS.COO_RUNTIME_APPROVAL_AUDIT, ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']]);
assert.deepStrictEqual(bridge.JOBS.FEDERAL_SOURCE_READINESS_AUDIT, ['node', ['SCRIPTS/AuditFederalSourceReadiness.js']]);
assert.deepStrictEqual(bridge.JOBS.INBOX_PLACEMENT_CREATE_FRESH, ['node', ['SCRIPTS/CreateControlledInstantlyInboxPlacementTest.js', '--execute', '--force-new']]);
assert.deepStrictEqual(bridge.JOBS.REVENUE_ACCEPTANCE_LATEST_PLACEMENT, ['node', ['SCRIPTS/RunRevenueAcceptanceLatestPlacement.js']]);
assert.deepStrictEqual(bridge.JOBS.ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN, ['node', ['SCRIPTS/PlanOrionOfficialSourceAcquisition.js']]);
assert.deepStrictEqual(bridge.JOBS.ORION_OFFICIAL_SOURCE_ACQUIRE_STAGING, ['node', ['SCRIPTS/AcquireOrionOfficialSourceToStaging.js']]);
assert.deepStrictEqual(bridge.JOBS.ORION_OFFICIAL_ARCHIVE_INSPECTION, ['node', ['SCRIPTS/InspectOrionOfficialArchives.js']]);
assert.deepStrictEqual(bridge.JOBS.ORION_REFRESH_TARGET_SCHEMA_AUDIT, ['node', ['SCRIPTS/AuditOrionRefreshTargetSchema.js']]);
assert.deepStrictEqual(bridge.JOBS.ORION_CONTRACT_SIDECAR_BUILD, ['node', ['SCRIPTS/BuildOrionContractSidecar.js']]);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY'}).ok, true);
assert.strictEqual(bridge.JOBS.CONTROL_OWNER_WATCHDOG_INSTALL[0], 'powershell.exe');
assert(bridge.JOBS.CONTROL_OWNER_WATCHDOG_INSTALL[1].includes('SCRIPTS/InstallMilesControlOwnerWatchdogWindows.ps1'));
assert.strictEqual(bridge.JOBS.CONTROL_OWNER_WATCHDOG_ENSURE[0], 'powershell.exe');
assert(bridge.JOBS.CONTROL_OWNER_WATCHDOG_ENSURE[1].includes('SCRIPTS/EnsureMilesControlOwnerWindows.ps1'));
assert.strictEqual(bridge.JOBS.CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE[0], 'powershell.exe');
assert(bridge.JOBS.CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE[1].includes('SCRIPTS/ScheduleMilesControlOwnerRecoveryProofWindows.ps1'));
assert.strictEqual(bridge.JOBS.CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY[0], 'powershell.exe');
assert(bridge.JOBS.CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY[1].includes('SCRIPTS/VerifyMilesControlOwnerRecoveryProofWindows.ps1'));
assert.deepStrictEqual(bridge.JOBS.IONOS_INBOX_CLEANUP_PLAN, ['node', ['SCRIPTS/RunIonosInboxCleanup.js']]);
assert.deepStrictEqual(bridge.JOBS.IONOS_INBOX_CLEANUP_EXECUTE, ['node', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']]);
assert.deepStrictEqual(bridge.JOBS.IONOS_SPAM_RESCUE_PLAN, ['node', ['SCRIPTS/RunIonosSpamRescue.js']]);
assert.deepStrictEqual(bridge.JOBS.IONOS_SPAM_RESCUE_EXECUTE, ['node', ['SCRIPTS/RunIonosSpamRescue.js', '--execute']]);
assert.deepStrictEqual(bridge.JOBS.INSTANTLY_LIFECYCLE_PROOF_PLAN, ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js']]);
assert.deepStrictEqual(bridge.JOBS.INSTANTLY_LIFECYCLE_PROOF_EXECUTE, ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']]);
assert.deepStrictEqual(bridge.JOBS.INSTANTLY_ZERO_COST_OAUTH_INIT_MISSING, ['node', ['SCRIPTS/RunInstantlyGoogleOAuthZeroCostMissingBatch.js', '--authorization', 'AUTHORIZE_ZERO_COST_PAID_SENDER_GOOGLE_OAUTH']]);
assert.strictEqual(bridge.CONTROL_BRANCH, 'miles-control');
assert(bridge.DIRECTIVE_URL.includes('/miles-control/DATA/control/miles_remote_execution_directive.json'));
assert.strictEqual(bridge.EVIDENCE_BRANCH, 'miles-runtime-evidence');
assert.strictEqual(bridge.EVIDENCE_REPO_PATH, 'DATA/control/miles_remote_execution_result.json');
assert(bridge.PROGRESS_MS >= 30000);
assert(bridge.DIRECTIVE_HTTP_TIMEOUT_MS >= 5000);
assert(bridge.GIT_COMMAND_TIMEOUT_MS >= 10000);
assert.strictEqual(typeof bridge.run, 'function');
assert.strictEqual(typeof bridge.gitRun, 'function');
assert.strictEqual(typeof bridge.STARTUP_SOURCE_DIGEST, 'string');
assert(bridge.STARTUP_SOURCE_DIGEST.length > 0);
assert.strictEqual(bridge.sourceDigest(), bridge.STARTUP_SOURCE_DIGEST);
assert.strictEqual(bridge.bridgeSourceChanged(bridge.STARTUP_SOURCE_DIGEST), false);
assert.deepStrictEqual(bridge.baseEvidence({ id: 'x', job: 'REVENUE_ACCEPTANCE_SPRINT' }, '2026-01-01T00:00:00.000Z', 'STARTED').phase, 'STARTED');
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'REVENUE_UNIVERSE_RECONCILIATION'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'FY2026_AWARDED_UNIVERSE_COVERAGE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'SIX_FY_AWARDED_UNIVERSE_NORMALIZE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INFRASTRUCTURE_HEALTH_AUDIT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'FEDERAL_SOURCE_READINESS_AUDIT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INBOX_PLACEMENT_CREATE_FRESH'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'REVENUE_ACCEPTANCE_LATEST_PLACEMENT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'CONTROL_OWNER_WATCHDOG_INSTALL'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'CONTROL_OWNER_WATCHDOG_ENSURE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_INBOX_CLEANUP_PLAN'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_INBOX_CLEANUP_EXECUTE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_SPAM_RESCUE_PLAN'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_SPAM_RESCUE_EXECUTE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INSTANTLY_LIFECYCLE_PROOF_PLAN'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INSTANTLY_LIFECYCLE_PROOF_EXECUTE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INSTANTLY_ZERO_COST_OAUTH_INIT_MISSING'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'SAM_PUBLIC_EMAIL_DISCOVERY'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'POWERSHELL'}).ok, false);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:false,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, false);
assert.strictEqual(typeof bridge.publishEvidenceSerialized, 'function');
assert.strictEqual(typeof bridge.relaunchCurrentBridge, 'function');

const src = fs.readFileSync(path.join(__dirname, '..', 'StartMilesRemoteExecutionBridge.js'), 'utf8');
assert(src.includes("gitRun(['fetch', 'origin', 'main'])"));
assert(src.includes("gitRun(['merge', '--ff-only', 'origin/main'])"));
assert(src.includes('request.setTimeout(DIRECTIVE_HTTP_TIMEOUT_MS'));
assert(src.includes('COMMAND_TIMEOUT_${timeoutMs}MS'));
assert(src.includes('timeoutMs: GIT_COMMAND_TIMEOUT_MS'));
assert(src.includes('child.kill()'));
assert(src.includes("refs/heads/${EVIDENCE_BRANCH}"));
assert(src.includes('GIT_INDEX_FILE'));
assert(src.includes("'commit-tree'"));
assert(src.includes("baseEvidence(directive, startedAt, 'STARTED')"));
assert(src.includes("baseEvidence(directive, startedAt, 'RUNNING')"));
assert(src.includes('publishEvidenceSerialized'));
assert(src.includes('evidencePublishTail'));
assert(src.includes('crypto.randomBytes(6)'));
assert(src.includes('remote-evidence-${process.pid}-${indexNonce}.index'));
assert(!src.includes('remote-evidence-${process.pid}.index'));
assert(src.includes('SELF-RELOAD'));
assert(src.includes('SELF_RELOAD_SPAWN_TIMEOUT'));
assert(src.includes('SELF_RELOAD_CHILD_EXITED_EARLY'));
assert(src.includes("child.once('spawn'"));
assert(src.includes('await new Promise(resolve => setTimeout(resolve, 750))'));
assert(src.includes('detached: true'));
assert(src.includes("stdio: 'ignore'"));
const executeStart = src.indexOf('async function executeDirective');
const refreshPos = src.indexOf('await safeFastForward();', executeStart);
const validatePos = src.indexOf('const validation = validateDirective(directive);', executeStart);
assert(refreshPos > executeStart && validatePos > refreshPos, 'trusted main refresh must happen before allowlist validation so new jobs can self-update safely');
assert(!src.includes('refs/heads/main'));
assert(!src.includes('reset --hard'));
assert(!src.includes('git clean'));
assert(!src.includes('shell: true'));
assert(src.includes("INBOX_PLACEMENT_CREATE_FRESH: ['node', ['SCRIPTS/CreateControlledInstantlyInboxPlacementTest.js', '--execute', '--force-new']]"));
assert(src.includes("REVENUE_ACCEPTANCE_LATEST_PLACEMENT: ['node', ['SCRIPTS/RunRevenueAcceptanceLatestPlacement.js']]"));
assert(!src.includes('RemediateNamecheapDmarc'));
assert(!src.includes('sendReply'));

const infraRunner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInfrastructureHealthAudit.js'), 'utf8');
assert(infraRunner.includes('arbitraryShell: false'));
assert(infraRunner.includes('destructiveActionsPerformed: false'));
assert(infraRunner.includes('providerMutation: false'));
assert(infraRunner.includes('controlPlaneRestartOnlyWhenSourceNewer: true'));
assert(infraRunner.includes("restartTargetAllowlisted: 'miles-command-center'"));
assert(!infraRunner.includes('exec('));
assert(!infraRunner.includes('shell: true'));

const watchdogProcess = fs.readFileSync(path.join(__dirname, '..', 'StartMilesControlOwnerWatchdog.js'), 'utf8');
const installer = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'InstallMilesControlOwnerWatchdogWindows.ps1'), 'utf8');
const proofScheduler = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofLauncher = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'LaunchMilesControlOwnerRecoveryProof.js'), 'utf8');
const proofRunner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofFailsafe = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunMilesControlOwnerRecoveryFailsafeWindows.ps1'), 'utf8');
const proofVerifier = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'VerifyMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
assert(watchdogProcess.includes("spawn('powershell.exe'"));
assert(watchdogProcess.includes('fixedEnsureScriptOnly: true'));
assert(watchdogProcess.includes('setInterval(tick, INTERVAL_MS)'));
assert(!watchdogProcess.includes('shell: true'));
assert(installer.includes('USER_STARTUP_INDEPENDENT_PROCESS'));
assert(installer.includes('CreateShortcut'));
assert(!installer.includes('Register-ScheduledTask'));
assert(proofScheduler.includes('DETACHED_FIXED_PROCESS'));
assert(proofScheduler.includes('LaunchMilesControlOwnerRecoveryProof.js'));
assert(proofScheduler.includes('& node.exe $DetachedLauncher'));
assert(!proofScheduler.includes('Start-Process -FilePath $powershell'));
assert(!proofScheduler.includes('New-ScheduledTaskTrigger'));
assert(proofLauncher.includes("spawn('powershell.exe'"));
assert(proofLauncher.includes('detached: true'));
assert(proofLauncher.includes("stdio: ['ignore', logFd, logFd]"));
assert(proofLauncher.includes('shell: false'));
assert(proofLauncher.includes('child.unref()'));
assert(proofLauncher.includes('isPidAlive(child.pid)'));
assert(proofLauncher.includes('DETACHED_RECOVERY_PROOF_NOT_ALIVE'));
assert(!proofLauncher.includes('shell: true'));
assert(proofRunner.includes('& pm2.cmd stop $ProcessName'));
assert(proofRunner.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN'));
assert(proofRunner.includes('recoveryMustComeFromIndependentWatchdog = $true'));
assert(proofRunner.includes('bridgeRecoveryRequired = $true'));
assert(proofRunner.includes('INDEPENDENT_WATCHDOG_DID_NOT_PROVE_OWNER_AND_BRIDGE_RECOVERY_WITHIN_180_SECONDS_FAILSAFE_LEFT_ARMED'));
assert(proofRunner.includes('RunMilesControlOwnerRecoveryFailsafeWindows.ps1'));
assert(!proofRunner.includes('Register-ScheduledTask'));
assert(proofFailsafe.includes('CONTROL_OWNER_RECOVERY_FAILSAFE_EXECUTED'));
assert(proofFailsafe.includes('CONTROL_OWNER_RECOVERY_FAILSAFE_CANCELED'));
assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED'));
assert(proofVerifier.includes('RECOVERY_PROOF_WATCHDOG_EVIDENCE_NOT_POST_STOP'));
assert(proofVerifier.includes('RECOVERY_PROOF_BRIDGE_HEALTH_MISSING'));
assert(proofVerifier.includes('USER_STARTUP_INDEPENDENT_PROCESS'));
assert(!proofVerifier.includes('Get-ScheduledTask'));
for (const proofScript of [installer, proofScheduler, proofLauncher, proofRunner, proofFailsafe, proofVerifier]) {
  assert(!/Invoke-Expression|\biex\b/i.test(proofScript), 'recovery proof must not evaluate arbitrary commands');
  assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(proofScript), 'recovery proof must not perform Git mutation/destructive recovery');
}

console.log('REMOTE_EXECUTION_BRIDGE_SAFETY=PASS');
