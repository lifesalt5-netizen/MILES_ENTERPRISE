"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/OutboundLeadGovernanceConvergenceService");

function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
function csv(rows) { return rows.join("\n"); }

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-governance-"));
const source = path.join(root, "source");
const out = path.join(root, "out");

write(path.join(source, "SBS_FILTERED_TARGETS_OK_ONLY_MILLIONVERIFIER.csv"), csv([
  "UEI,Company Name,Contact Name,Email,verification_status",
  "UEI1,Alpha LLC,Alice,alice@alpha.com,valid",
  "UEI1,Alpha LLC,Bob,bob@alpha.com,valid",
  "UEI2,Beta LLC,Beth,beth@beta.com,valid",
  "UEI3,Gamma LLC,Gary,gary@gamma.com,invalid",
  "UEI4,Delta LLC,Dan,dan@delta.com,valid"
]));

write(path.join(source, "GSA_NO_SALES.csv"), csv([
  "UEI,Company Name,Email",
  "UEI1,Alpha LLC,alice@alpha.com",
  "UEI1,Alpha LLC,bob@alpha.com"
]));
write(path.join(source, "HUBZONE.csv"), csv([
  "UEI,Company Name,Email",
  "UEI1,Alpha LLC,alice@alpha.com",
  "UEI2,Beta LLC,beth@beta.com"
]));
write(path.join(source, "SLED_STATE_VENDOR_EMAILS.csv"), csv([
  "UEI,Company Name,Email",
  "UEI2,Beta LLC,beth@beta.com",
  "UEI4,Delta LLC,dan@delta.com"
]));

const result = new Service({ rootDir: root, scanRoots: [source], outputDir: out }).run();
const routedText = fs.readFileSync(result.outputs.routedFile, "utf8");
const lines = routedText.split(/\r?\n/).filter(Boolean);

const checks = {
  serviceOk: result.ok === true,
  invalidRejected: result.counts.rejectedEmails === 1,
  verifiedOnly: !routedText.includes("gary@gamma.com"),
  multipleContactsPreserved: routedText.includes("alice@alpha.com") && routedText.includes("bob@alpha.com"),
  alphaHighestPriorityGsa: lines.filter(x => x.includes("@alpha.com")).every(x => x.includes("GSA_NO_SALES")),
  betaCertificationBeatsSled: lines.find(x => x.includes("beth@beta.com"))?.includes("HUBZONE") === true,
  sledGoverned: lines.find(x => x.includes("dan@delta.com"))?.includes("SLED_STATE_VENDOR_EMAILS") === true,
  oneEmailOnce: lines.filter(x => x.includes("alice@alpha.com")).length === 1,
  noLiveMutation: result.liveCampaignsMutated === false,
  refreshRegistryCreated: fs.existsSync(result.outputs.refreshRegistry),
  governanceManifestCreated: fs.existsSync(result.outputs.governanceManifest)
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, gate: "OUTBOUND_LEAD_GOVERNANCE_CONVERGENCE_TEST", checks, failed, result }, null, 2));
process.exitCode = failed.length ? 1 : 0;
