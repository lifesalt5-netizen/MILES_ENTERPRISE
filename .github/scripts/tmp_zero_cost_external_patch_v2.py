from pathlib import Path

# Add fresh external exact-sender placement evidence as an alternate source for the
# existing fail-closed sender-capacity audit. External evidence never weakens the
# ACTIVE rule; it only supplies a fresh exact-sender source when Instantly's own
# placement-test quota is exhausted.
audit = Path('SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js')
s = audit.read_text(encoding='utf-8')

placement_fn = """function loadPlacementGovernance() {
  const file = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability', 'instantly_inbox_placement_latest.json');
  const report = readJson(file);
  const reportAgeHours = ageHours(report?.generatedAt);
  const fresh = reportAgeHours !== null && reportAgeHours >= 0 && reportAgeHours <= PLACEMENT_EVIDENCE_MAX_AGE_HOURS;
  const senderMap = new Map();
  if (fresh && Array.isArray(report?.senders)) {
    for (const sender of report.senders) {
      const email = String(sender?.sender || '').trim().toLowerCase();
      if (email) senderMap.set(email, sender);
    }
  }
  return {
    file,
    exists: Boolean(report),
    generatedAt: report?.generatedAt || null,
    ageHours: reportAgeHours,
    fresh,
    scope: report?.testScope || report?.scope || null,
    verificationStatus: report?.verificationStatus || null,
    truth: report?.truth || null,
    senderMap
  };
}
"""
external_fn = """
function loadExternalPlacementGovernance() {
  const file = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability', 'external_inbox_placement_latest.json');
  const report = readJson(file);
  const reportAgeHours = ageHours(report?.generatedAt);
  const fresh = reportAgeHours !== null && reportAgeHours >= 0 && reportAgeHours <= PLACEMENT_EVIDENCE_MAX_AGE_HOURS;
  const senderMap = new Map();
  if (fresh && Array.isArray(report?.senders)) {
    for (const sender of report.senders) {
      const email = String(sender?.sender || '').trim().toLowerCase();
      if (email) senderMap.set(email, sender);
    }
  }
  return {
    file,
    exists: Boolean(report),
    generatedAt: report?.generatedAt || null,
    ageHours: reportAgeHours,
    fresh,
    source: report?.source || null,
    status: report?.status || null,
    senderMap
  };
}
"""
if 'function loadExternalPlacementGovernance()' not in s:
    if placement_fn not in s:
        raise SystemExit('placement governance anchor not found')
    s = s.replace(placement_fn, placement_fn + external_fn, 1)

if 'const externalPlacement = loadExternalPlacementGovernance();' not in s:
    anchor = "  const placement = loadPlacementGovernance();\n"
    if anchor not in s:
        raise SystemExit('placement main anchor not found')
    s = s.replace(anchor, anchor + "  const externalPlacement = loadExternalPlacementGovernance();\n", 1)

old_row = """    const placementEvidence = placement.senderMap.get(email) || null;
    const placementStatus = placementEvidence?.status || 'UNVERIFIED';
    const governedUsable = providerOk && placement.fresh && placementStatus === 'ACTIVE';
    const row = {
      email,
      status: statusOf(account),
      providerUsable: providerOk,
      placementStatus,
      placementEvidenceFresh: placement.fresh,
      governedUsable
    };
"""
new_row = """    const instantlyPlacementEvidence = placement.senderMap.get(email) || null;
    const externalPlacementEvidence = externalPlacement.senderMap.get(email) || null;
    const placementEvidence = externalPlacement.fresh && externalPlacementEvidence
      ? externalPlacementEvidence
      : placement.fresh && instantlyPlacementEvidence
        ? instantlyPlacementEvidence
        : null;
    const placementStatus = placementEvidence?.status || 'UNVERIFIED';
    const placementEvidenceFresh = Boolean(placementEvidence);
    const placementSource = externalPlacement.fresh && externalPlacementEvidence
      ? (externalPlacement.source || 'EXTERNAL_PLACEMENT')
      : placement.fresh && instantlyPlacementEvidence
        ? 'INSTANTLY_API_V2_INBOX_PLACEMENT'
        : null;
    const governedUsable = providerOk && placementEvidenceFresh && placementStatus === 'ACTIVE';
    const row = {
      email,
      status: statusOf(account),
      providerUsable: providerOk,
      placementStatus,
      placementEvidenceFresh,
      placementSource,
      governedUsable
    };
"""
if old_row in s:
    s = s.replace(old_row, new_row, 1)
elif 'const externalPlacementEvidence = externalPlacement.senderMap.get(email)' not in s:
    raise SystemExit('sender row anchor not found')

old_report = """    placementGovernance: {
      file: path.relative(root, placement.file),
      exists: placement.exists,
      generatedAt: placement.generatedAt,
      ageHours: placement.ageHours,
      fresh: placement.fresh,
      maxAgeHours: PLACEMENT_EVIDENCE_MAX_AGE_HOURS,
      truth: placement.truth,
      verificationStatus: placement.verificationStatus,
      rule: 'Governed usable requires provider-usable account plus fresh sender placement status ACTIVE. WATCH or UNVERIFIED senders contribute zero governed capacity.'
    },
"""
new_report = """    placementGovernance: {
      instantly: {
        file: path.relative(root, placement.file),
        exists: placement.exists,
        generatedAt: placement.generatedAt,
        ageHours: placement.ageHours,
        fresh: placement.fresh,
        truth: placement.truth,
        verificationStatus: placement.verificationStatus
      },
      external: {
        file: path.relative(root, externalPlacement.file),
        exists: externalPlacement.exists,
        generatedAt: externalPlacement.generatedAt,
        ageHours: externalPlacement.ageHours,
        fresh: externalPlacement.fresh,
        source: externalPlacement.source,
        status: externalPlacement.status
      },
      maxAgeHours: PLACEMENT_EVIDENCE_MAX_AGE_HOURS,
      rule: 'Governed usable requires provider-usable account plus fresh exact-sender placement status ACTIVE. Fresh external seed evidence may supply placement truth when the Instantly test quota is exhausted; WATCH or UNVERIFIED still contributes zero governed capacity.'
    },
"""
if old_report in s:
    s = s.replace(old_report, new_report, 1)
elif 'external: {' not in s:
    raise SystemExit('placement report anchor not found')

old_log = "  console.log(`Placement evidence fresh: ${placement.fresh}`);"
new_log = "  console.log(`Placement evidence fresh: ${placement.fresh || externalPlacement.fresh}`);\n  console.log(`External placement evidence fresh: ${externalPlacement.fresh}`);"
if old_log in s:
    s = s.replace(old_log, new_log, 1)

old_export = "module.exports = { providerUsable, ageHours, ZERO_COST_PAID_SEAT_TARGET, ZERO_COST_TARGET_MAILBOXES };"
new_export = "module.exports = { providerUsable, ageHours, ZERO_COST_PAID_SEAT_TARGET, ZERO_COST_TARGET_MAILBOXES, loadExternalPlacementGovernance };"
if old_export in s:
    s = s.replace(old_export, new_export, 1)

audit.write_text(s, encoding='utf-8')

# Add only two fixed bridge jobs: one exact external test runner and one read-only
# sender FULL-GO gate. No arbitrary arguments or shell access.
bridge = Path('StartMilesRemoteExecutionBridge.js')
b = bridge.read_text(encoding='utf-8')
if 'OUTBOUND_SENDER_CAPACITY_FULL_GO:' not in b:
    anchor = "  ORION_REFRESH_TARGET_SCHEMA_AUDIT: ['node', ['SCRIPTS/AuditOrionRefreshTargetSchema.js']],\n"
    if anchor not in b:
        raise SystemExit('bridge outbound gate anchor not found')
    b = b.replace(anchor, anchor + "  OUTBOUND_SENDER_CAPACITY_FULL_GO: ['node', ['SCRIPTS/RunOutboundSenderCapacityFullGoGate.js']],\n", 1)
if 'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE:' not in b:
    end_anchor = "  SAM_PUBLIC_EMAIL_DISCOVERY: ['node', ['SCRIPTS/DiscoverSamPublicEmails.js']]\n});"
    if end_anchor not in b:
        raise SystemExit('bridge stable end anchor not found')
    b = b.replace(end_anchor, "  SAM_PUBLIC_EMAIL_DISCOVERY: ['node', ['SCRIPTS/DiscoverSamPublicEmails.js']],\n  ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE: ['node', ['SCRIPTS/RunZeroCostExternalInboxPlacement.js', '--authorization', 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS']]\n});", 1)
bridge.write_text(b, encoding='utf-8')

# Keep the bridge's exact allowlist contract synchronized.
test = Path('TESTS/remote_execution_bridge_safety.test.js')
t = test.read_text(encoding='utf-8')
if "  'OUTBOUND_SENDER_CAPACITY_FULL_GO',\n" not in t:
    anchor = "  'ORION_REFRESH_TARGET_SCHEMA_AUDIT',\n"
    if anchor not in t:
        raise SystemExit('safety list outbound anchor not found')
    t = t.replace(anchor, anchor + "  'OUTBOUND_SENDER_CAPACITY_FULL_GO',\n", 1)
if "  'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE'\n" not in t:
    anchor = "  'SIX_FY_AWARDED_UNIVERSE_NORMALIZE'\n]);"
    if anchor not in t:
        raise SystemExit('safety list external anchor not found')
    t = t.replace(anchor, "  'SIX_FY_AWARDED_UNIVERSE_NORMALIZE',\n  'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE'\n]);", 1)

oauth_assert = "assert.deepStrictEqual(bridge.JOBS.INSTANTLY_ZERO_COST_OAUTH_BROWSER_GUARDED, ['node', ['SCRIPTS/RunInstantlyGoogleOAuthBrowserGuarded.js', '--authorization', 'AUTHORIZE_EXISTING_AUTHENTICATED_GOOGLE_OAUTH_CONSENT']]);\n"
if 'assert.deepStrictEqual(bridge.JOBS.OUTBOUND_SENDER_CAPACITY_FULL_GO' not in t:
    if oauth_assert not in t:
        raise SystemExit('safety assertion anchor not found')
    t = t.replace(oauth_assert, oauth_assert + "assert.deepStrictEqual(bridge.JOBS.OUTBOUND_SENDER_CAPACITY_FULL_GO, ['node', ['SCRIPTS/RunOutboundSenderCapacityFullGoGate.js']]);\nassert.deepStrictEqual(bridge.JOBS.ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE, ['node', ['SCRIPTS/RunZeroCostExternalInboxPlacement.js', '--authorization', 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS']]);\n", 1)

validate = "assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INSTANTLY_ZERO_COST_OAUTH_BROWSER_GUARDED'}).ok, true);\n"
if "job:'OUTBOUND_SENDER_CAPACITY_FULL_GO'" not in t:
    if validate not in t:
        raise SystemExit('safety validate anchor not found')
    t = t.replace(validate, validate + "assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'OUTBOUND_SENDER_CAPACITY_FULL_GO'}).ok, true);\nassert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE'}).ok, true);\n", 1)

test.write_text(t, encoding='utf-8')
