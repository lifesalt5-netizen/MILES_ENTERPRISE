from pathlib import Path

audit = Path('SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js')
s = audit.read_text(encoding='utf-8')
old = """function loadPlacementGovernance() {
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
new = old + """
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
if old not in s:
    raise SystemExit('placement governance anchor not found')
s = s.replace(old, new, 1)
s = s.replace("  const placement = loadPlacementGovernance();\n", "  const placement = loadPlacementGovernance();\n  const externalPlacement = loadExternalPlacementGovernance();\n", 1)
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
if old_row not in s:
    raise SystemExit('row anchor not found')
s = s.replace(old_row, new_row, 1)
marker = """    placementGovernance: {
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
replacement = """    placementGovernance: {
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
      rule: 'Governed usable requires provider-usable account plus fresh sender placement status ACTIVE. Fresh exact-sender external seed evidence supersedes older Instantly evidence when the provider free-test quota is exhausted. WATCH or UNVERIFIED senders contribute zero governed capacity.'
    },
"""
if marker not in s:
    raise SystemExit('report marker not found')
s = s.replace(marker, replacement, 1)
s = s.replace("  console.log(`Placement evidence fresh: ${placement.fresh}`);", "  console.log(`Placement evidence fresh: ${placement.fresh || externalPlacement.fresh}`);\n  console.log(`External placement evidence fresh: ${externalPlacement.fresh}`);", 1)
s = s.replace("module.exports = { providerUsable, ageHours, ZERO_COST_PAID_SEAT_TARGET, ZERO_COST_TARGET_MAILBOXES };", "module.exports = { providerUsable, ageHours, ZERO_COST_PAID_SEAT_TARGET, ZERO_COST_TARGET_MAILBOXES, loadExternalPlacementGovernance };", 1)
audit.write_text(s, encoding='utf-8')

bridge = Path('StartMilesRemoteExecutionBridge.js')
b = bridge.read_text(encoding='utf-8')
anchor = "  ORION_REFRESH_TARGET_SCHEMA_AUDIT: ['node', ['SCRIPTS/AuditOrionRefreshTargetSchema.js']],\n"
if anchor not in b:
    raise SystemExit('bridge anchor not found')
b = b.replace(anchor, anchor + "  OUTBOUND_SENDER_CAPACITY_FULL_GO: ['node', ['SCRIPTS/RunOutboundSenderCapacityFullGoGate.js']],\n", 1)
anchor2 = "  SIX_FY_AWARDED_UNIVERSE_NORMALIZE: ['node', ['SCRIPTS/RunSixFiscalYearAwardUniverseNormalization.js']]\n"
if anchor2 not in b:
    raise SystemExit('bridge end anchor not found')
b = b.replace(anchor2, "  SIX_FY_AWARDED_UNIVERSE_NORMALIZE: ['node', ['SCRIPTS/RunSixFiscalYearAwardUniverseNormalization.js']],\n  ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE: ['node', ['SCRIPTS/RunZeroCostExternalInboxPlacement.js', '--authorization', 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS']]\n", 1)
bridge.write_text(b, encoding='utf-8')

test = Path('TESTS/remote_execution_bridge_safety.test.js')
t = test.read_text(encoding='utf-8')
t = t.replace("  'ORION_REFRESH_TARGET_SCHEMA_AUDIT',\n", "  'ORION_REFRESH_TARGET_SCHEMA_AUDIT',\n  'OUTBOUND_SENDER_CAPACITY_FULL_GO',\n", 1)
t = t.replace("  'SIX_FY_AWARDED_UNIVERSE_NORMALIZE'\n]);", "  'SIX_FY_AWARDED_UNIVERSE_NORMALIZE',\n  'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE'\n]);", 1)
insert = "assert.deepStrictEqual(bridge.JOBS.INSTANTLY_ZERO_COST_OAUTH_BROWSER_GUARDED, ['node', ['SCRIPTS/RunInstantlyGoogleOAuthBrowserGuarded.js', '--authorization', 'AUTHORIZE_EXISTING_AUTHENTICATED_GOOGLE_OAUTH_CONSENT']]);\n"
if insert not in t:
    raise SystemExit('safety assertion anchor not found')
t = t.replace(insert, insert + "assert.deepStrictEqual(bridge.JOBS.OUTBOUND_SENDER_CAPACITY_FULL_GO, ['node', ['SCRIPTS/RunOutboundSenderCapacityFullGoGate.js']]);\nassert.deepStrictEqual(bridge.JOBS.ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE, ['node', ['SCRIPTS/RunZeroCostExternalInboxPlacement.js', '--authorization', 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS']]);\n", 1)
validate = "assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'INSTANTLY_ZERO_COST_OAUTH_BROWSER_GUARDED'}).ok, true);\n"
if validate not in t:
    raise SystemExit('validate anchor not found')
t = t.replace(validate, validate + "assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'OUTBOUND_SENDER_CAPACITY_FULL_GO'}).ok, true);\nassert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE'}).ok, true);\n", 1)
test.write_text(t, encoding='utf-8')
