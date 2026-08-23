'use strict';

const fs = require('fs');
const path = require('path');

function parse(argv) {
  const root = argv.find(v => v.startsWith('--root='));
  return { rootDir: path.resolve(root ? root.slice(7) : process.env.MILES_ROOT || process.cwd()) };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'DATA'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs|json|md|html|ps1)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(root, file) { return path.relative(root, file).replace(/\\/g, '/'); }

function containsAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some(term => lower.includes(String(term).toLowerCase()));
}

function evidence(files, terms, max = 12) {
  const hits = [];
  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (containsAny(text, terms) || terms.some(t => path.basename(file).toLowerCase().includes(String(t).toLowerCase().replace(/[^a-z0-9]/g, '')))) {
      hits.push(file);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

function main() {
  const { rootDir } = parse(process.argv.slice(2));
  const files = walk(rootDir);

  const capabilities = [
    ['solicitation_intake', ['solicitation intake','solicitation document','solicitation_id','solicitationId']],
    ['amendment_control', ['amendment','q&a','question and answer','controlling version']],
    ['stage0_qualification', ['P2GCSalesQualificationService','GO_WITH_RISK','TEAMING_REQUIRED','NO_GO','stage 0']],
    ['requirement_extraction', ['requirement extraction','mandatory requirement','requirements matrix']],
    ['section_l_instructions', ['section l','instruction matrix']],
    ['section_m_evaluation', ['section m','evaluation crosswalk','evaluation criteria']],
    ['evidence_vault', ['evidence vault','company dna','claim','proof','last verified']],
    ['capture_intelligence', ['capture positioning','incumbent','competitive intelligence','agency buying']],
    ['win_themes', ['win theme','value positioning']],
    ['compliance_matrix', ['compliance matrix','requirement traceability']],
    ['drafting', ['proposal draft','technical approach','management approach','staffing plan','past performance']],
    ['personnel_compliance', ['personnel compliance','key personnel matrix']],
    ['pricing_support', ['pricing intelligence','pricing template','walk-away']],
    ['evaluator_review', ['evaluator simulation','evaluator review','red team']],
    ['revision_resolution', ['revision','resolution state','comment resolution']],
    ['final_compliance', ['final compliance','binary compliance']],
    ['production_qa', ['production qa','submission package','submission manifest']],
    ['kevin_approval_gate', ['READY FOR KEVIN APPROVAL','kevin approval','final submission authorization']],
    ['submission_protection', ['externalSubmissionEnabled','submission evidence','SUBMITTED']],
    ['post_submission', ['clarification','discussion','FPR','BAFO','debrief','lessons learned']],
    ['dashboard_surface', ['proposal command','proposal dashboard','active proposal','qualification status','compliance %']]
  ];

  const rows = capabilities.map(([id, terms]) => {
    const hits = evidence(files, terms).map(f => rel(rootDir, f));
    return {
      capability: id,
      status: hits.length ? 'SOURCE_EVIDENCE_FOUND_NOT_YET_E2E_VERIFIED' : 'MISSING_SOURCE_EVIDENCE',
      evidenceFiles: hits
    };
  });

  const hardRequirements = ['solicitation_intake','stage0_qualification','requirement_extraction','section_l_instructions','section_m_evaluation','evidence_vault','compliance_matrix','evaluator_review','production_qa','kevin_approval_gate','submission_protection','dashboard_surface'];
  const hardMissing = rows.filter(r => hardRequirements.includes(r.capability) && r.status === 'MISSING_SOURCE_EVIDENCE');
  const missing = rows.filter(r => r.status === 'MISSING_SOURCE_EVIDENCE');

  const stage0Path = path.join(rootDir, 'SERVICES', 'sales', 'P2GCSalesQualificationService.js');
  const stage0Exists = fs.existsSync(stage0Path);
  let stage0Naming = null;
  if (stage0Exists) {
    const text = fs.readFileSync(stage0Path, 'utf8');
    stage0Naming = {
      usesUnderscoreGoWithRisk: text.includes('GO_WITH_RISK'),
      usesUnderscoreNoGo: text.includes('NO_GO'),
      exactHumanDecisionStringsRequired: ['GO','GO WITH RISK','TEAMING REQUIRED','NO-GO']
    };
  }

  const result = {
    ok: hardMissing.length === 0,
    service: 'P2GC_PROPOSAL_COMMAND_READINESS_AUDIT',
    generatedAt: new Date().toISOString(),
    rootDir,
    standard: 'Static/source inventory only. SOURCE_EVIDENCE_FOUND is not callable/E2E acceptance.',
    hardRequirements,
    hardMissing: hardMissing.map(x => x.capability),
    missingCapabilities: missing.map(x => x.capability),
    stage0: { exists: stage0Exists, path: stage0Exists ? rel(rootDir, stage0Path) : null, naming: stage0Naming },
    capabilities: rows,
    acceptanceRule: 'Production acceptance still requires one real client + one real Government solicitation through the full controlled pipeline and actual submission proof before SUBMITTED.'
  };

  const outDir = path.join(rootDir, 'DATA', 'operational_acceptance', 'proposal_command');
  fs.mkdirSync(outDir, { recursive: true });
  result.outputFile = path.join(outDir, 'PROPOSAL_COMMAND_READINESS_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

try { main(); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
