"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.env.MILES_ROOT || process.cwd();

function normalize(value) {
  return String(value == null ? "" : value).trim();
}

function upper(value) {
  return normalize(value).toUpperCase();
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loadRules(rulesFile) {
  const file = rulesFile || path.join(ROOT, "CONFIG", "state_sled_segmentation_rules.json");
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function isValidState(value) {
  return /^[A-Z]{2}$/.test(upper(value));
}

function matchesAny(value, allowed = []) {
  const needle = upper(value);
  return allowed.map(upper).includes(needle);
}

function baseEligible(row, rules) {
  const statusOk = matchesAny(row.Entity_Status, rules.required?.Entity_Status || ["A"]);
  const countryOk = matchesAny(row.Country, rules.required?.Country || ["USA"]);
  const stateOk = rules.required?.validStateRequired === false || isValidState(row.NORMALIZED_STATE || row.State);
  const industry = upper(row.Industry_Segment);
  const excluded = (rules.excludedIndustriesForInitialOutbound || []).map(upper).includes(industry);
  return statusOk && countryOk && stateOk && !excluded;
}

function qualifiesWave(row, wave = {}) {
  if (Array.isArray(wave.states) && wave.states.length > 0) {
    const state = upper(row.NORMALIZED_STATE || row.State);
    if (!wave.states.map(upper).includes(state)) return false;
  }
  if (Array.isArray(wave.industries) && wave.industries.length > 0 && !matchesAny(row.Industry_Segment, wave.industries)) return false;
  if (Array.isArray(wave.marketPriority) && wave.marketPriority.length > 0 && !matchesAny(row.Market_Priority, wave.marketPriority)) return false;
  if (Array.isArray(wave.consultingTier) && wave.consultingTier.length > 0) {
    const tier = normalize(row.Final_Consulting_Tier);
    if (!wave.consultingTier.map(normalize).includes(tier)) return false;
  }
  if (number(row.Lead_Score) < number(wave.minimumLeadScore, 0)) return false;
  return true;
}

function enrichmentDisposition(row, rules) {
  const email = normalize(row.POC_Email);
  if (!email) return rules.emailPolicy?.blankEmailDisposition || "ENRICHMENT_REQUIRED";
  return rules.emailPolicy?.unverifiedEmailDisposition || "VERIFICATION_REQUIRED";
}

function candidateRecord(row, wave, rules) {
  return {
    UEI: normalize(row.UEI),
    Legal_Name: normalize(row.Legal_Name),
    State: upper(row.NORMALIZED_STATE || row.State),
    City: normalize(row.City),
    Primary_NAICS: normalize(row.Primary_NAICS),
    Industry_Segment: upper(row.Industry_Segment),
    Market_Priority: upper(row.Market_Priority),
    Lead_Score: number(row.Lead_Score),
    Final_Consulting_Tier: normalize(row.Final_Consulting_Tier),
    Website: normalize(row.Website || row.NORMALIZED_WEBSITE),
    POC_Name: normalize(row.POC_Name),
    POC_Title: normalize(row.POC_Title),
    POC_Email: normalize(row.POC_Email),
    Federal_Award_Count: number(row.Federal_Award_Count),
    Federal_Total_Revenue: number(row.Federal_Total_Revenue),
    GovCon_Performance_Segment: normalize(row.GovCon_Performance_Segment),
    Legacy_Evan_Base_Qualified: normalize(row.evan_base_qualified),
    Legacy_Evan_Segment: normalize(row.evan_segment),
    P1_3_Wave: wave,
    EmailDisposition: enrichmentDisposition(row, rules)
  };
}

async function run(options = {}) {
  const rules = loadRules(options.rulesFile);
  const source = options.source || rules.source;
  const outDir = options.outputDirectory || path.join(ROOT, rules.outputDirectory || "DATA/OUTBOUND/STATE_SLED");

  if (!fs.existsSync(source)) {
    throw new Error(`State/SLED source not found: ${source}`);
  }

  ensureDir(outDir);

  const fields = [
    "UEI","Legal_Name","State","City","Primary_NAICS","Industry_Segment","Market_Priority","Lead_Score",
    "Final_Consulting_Tier","Website","POC_Name","POC_Title","POC_Email","Federal_Award_Count",
    "Federal_Total_Revenue","GovCon_Performance_Segment","Legacy_Evan_Base_Qualified","Legacy_Evan_Segment",
    "P1_3_Wave","EmailDisposition"
  ];

  const wave1File = path.join(outDir, "STATE_SLED_WAVE1_ENRICHMENT.csv");
  const wave2File = path.join(outDir, "STATE_SLED_WAVE2_ENRICHMENT.csv");
  const auditFile = path.join(outDir, "STATE_SLED_SEGMENTATION_AUDIT.json");

  const wave1 = fs.createWriteStream(wave1File, { encoding: "utf8" });
  const wave2 = fs.createWriteStream(wave2File, { encoding: "utf8" });
  const header = fields.join(",") + "\n";
  wave1.write(header);
  wave2.write(header);

  const seen = new Set();
  const stats = {
    source,
    generatedAt: new Date().toISOString(),
    totalRows: 0,
    duplicateIdentityRows: 0,
    baseEligible: 0,
    wave1: 0,
    wave2: 0,
    notSelected: 0,
    withSourceEmail: 0,
    withWebsite: 0,
    enrichmentRequired: 0,
    verificationRequired: 0,
    byStateWave1: {},
    byIndustryWave1: {},
    safety: rules.safety || {}
  };

  function writeRecord(stream, record) {
    stream.write(fields.map(field => csvEscape(record[field])).join(",") + "\n");
  }

  await new Promise((resolve, reject) => {
    fs.createReadStream(source)
      .pipe(csv())
      .on("data", row => {
        stats.totalRows += 1;
        const identity = normalize(row[rules.identityField || "UEI"]);
        if (identity && seen.has(identity)) {
          stats.duplicateIdentityRows += 1;
          return;
        }
        if (identity) seen.add(identity);

        if (!baseEligible(row, rules)) {
          stats.notSelected += 1;
          return;
        }
        stats.baseEligible += 1;

        const hasEmail = Boolean(normalize(row.POC_Email));
        const hasWebsite = Boolean(normalize(row.Website || row.NORMALIZED_WEBSITE));
        if (hasEmail) stats.withSourceEmail += 1;
        if (hasWebsite) stats.withWebsite += 1;

        let wave = null;
        if (qualifiesWave(row, rules.wave1 || {})) wave = "WAVE1";
        else if (qualifiesWave(row, rules.wave2 || {})) wave = "WAVE2";

        if (!wave) {
          stats.notSelected += 1;
          return;
        }

        const record = candidateRecord(row, wave, rules);
        if (record.EmailDisposition === "ENRICHMENT_REQUIRED") stats.enrichmentRequired += 1;
        if (record.EmailDisposition === "VERIFICATION_REQUIRED") stats.verificationRequired += 1;

        if (wave === "WAVE1") {
          stats.wave1 += 1;
          stats.byStateWave1[record.State] = (stats.byStateWave1[record.State] || 0) + 1;
          stats.byIndustryWave1[record.Industry_Segment] = (stats.byIndustryWave1[record.Industry_Segment] || 0) + 1;
          writeRecord(wave1, record);
        } else {
          stats.wave2 += 1;
          writeRecord(wave2, record);
        }
      })
      .on("error", reject)
      .on("end", resolve);
  });

  await Promise.all([
    new Promise(resolve => wave1.end(resolve)),
    new Promise(resolve => wave2.end(resolve))
  ]);

  fs.writeFileSync(auditFile, JSON.stringify(stats, null, 2), "utf8");

  return {
    ok: true,
    service: "StateSledSegmentationService",
    rulesVersion: rules.version,
    outputs: { wave1File, wave2File, auditFile },
    stats
  };
}

module.exports = { run, baseEligible, qualifiesWave, enrichmentDisposition };
