"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_fl_live_execution_rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on("data", row => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function selectHealthySenders(accounts, rules) {
  const minimumScore = Number(rules.senderPolicy?.minimumWarmupScore || 70);

  return unwrapItems(accounts)
    .filter(account => {
      const status = Number(account.status);
      const warmupStatus = Number(account.warmup_status);
      const setupPending = account.setup_pending === true;
      const scoreRaw = account.stat_warmup_score;
      const score = scoreRaw === undefined || scoreRaw === null || scoreRaw === ""
        ? null
        : Number(scoreRaw);

      if (!account.email || status !== 1 || setupPending) return false;
      if (warmupStatus < 0) return false;
      if (score !== null && Number.isFinite(score) && score < minimumScore) return false;
      return true;
    })
    .sort((a, b) => {
      const aScore = Number(a.stat_warmup_score || 0);
      const bScore = Number(b.stat_warmup_score || 0);
      return bScore - aScore || String(a.email).localeCompare(String(b.email));
    });
}

function buildCampaignPayload(rules, senderEmails) {
  return {
    name: rules.campaignName,
    sequences: [{ steps: rules.sequence.steps }],
    email_list: senderEmails,
    ...rules.campaign
  };
}

function buildLeadPayload(row, campaignId) {
  const email = first(row, ["discoveredEmail", "email", "Email"]);
  const legalName = first(row, ["legalName", "Legal_Name", "legal_name", "company_name"]);
  const domain = first(row, ["domain", "Domain", "website", "Website"]);
  const uei = first(row, ["uei", "UEI"]);

  return {
    campaign: campaignId,
    email,
    company_name: legalName || undefined,
    website: domain ? (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`) : undefined,
    custom_variables: uei ? { uei, source_segment: "STATE_SLED_FL" } : { source_segment: "STATE_SLED_FL" },
    skip_if_in_workspace: true,
    skip_if_in_campaign: true
  };
}

async function run(options = {}) {
  const rules = loadRules();
  const authorization = String(options.authorization || process.env.MILES_STATE_SLED_EXECUTION_AUTH || "").trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_STATE_SLED_EXECUTE_LIVE || "").toLowerCase() === "true";

  if (authorization !== rules.authorizationToken) {
    throw new Error("P1.3K authorization token missing or incorrect.");
  }

  if (!executeLive) {
    throw new Error("P1.3K live execution flag is not enabled.");
  }

  if (rules.safety?.activateCampaign !== false) {
    throw new Error("P1.3K safety invariant failed: activation must remain disabled.");
  }

  if (!rules.sequence?.approvedForThisExecution || !Array.isArray(rules.sequence.steps) || !rules.sequence.steps.length) {
    throw new Error("P1.3K sequence is not approved/configured.");
  }

  const verifiedFile = path.join(ROOT, rules.verifiedMasterFile);
  if (!fs.existsSync(verifiedFile)) throw new Error(`Verified master not found: ${verifiedFile}`);

  const allVerifiedRows = await readCsv(verifiedFile);
  const rows = allVerifiedRows.filter(row => {
    const state = first(row, ["state", "State", "NORMALIZED_STATE"]).toUpperCase();
    const email = first(row, ["discoveredEmail", "email", "Email"]);
    return state === rules.state && !!email;
  });

  const uniqueByEmail = new Map();
  for (const row of rows) {
    const email = first(row, ["discoveredEmail", "email", "Email"]).toLowerCase();
    if (email && !uniqueByEmail.has(email)) uniqueByEmail.set(email, row);
  }
  const leads = [...uniqueByEmail.values()];

  if (leads.length < Number(rules.minimumVerifiedLeads || 25)) {
    throw new Error(`Only ${leads.length} verified FL leads are available; minimum is ${rules.minimumVerifiedLeads}.`);
  }

  // The Instantly client captures these flags at module load, so set them before requiring the connector.
  process.env.MILES_DRY_RUN = "false";
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
  const connector = require("../CONNECTORS/INSTANTLY/connector");

  const campaignInventoryResult = await connector.execute({ action: "LIST_CAMPAIGNS", payload: { limit: 100 } });
  const liveCampaigns = unwrapItems(campaignInventoryResult?.campaigns);
  let campaign = liveCampaigns.find(c => String(c.name || "").trim().toUpperCase() === rules.campaignName.toUpperCase()) || null;
  let campaignCreated = false;

  const accountInventoryResult = await connector.execute({ action: "LIST_SENDING_ACCOUNTS", payload: { limit: 100 } });
  const healthySenders = selectHealthySenders(accountInventoryResult?.accounts, rules);
  const minimumHealthySenders = Number(rules.senderPolicy?.minimumHealthySenders || 1);

  if (healthySenders.length < minimumHealthySenders) {
    throw new Error(`Only ${healthySenders.length} healthy Instantly sender accounts found; minimum is ${minimumHealthySenders}.`);
  }

  const senderEmails = healthySenders.slice(0, minimumHealthySenders).map(x => x.email);

  if (!campaign) {
    const createResult = await connector.execute({
      action: "CREATE_CAMPAIGN",
      payload: buildCampaignPayload(rules, senderEmails)
    });

    campaign = createResult?.result || createResult?.campaign || null;
    if (!campaign?.id) {
      throw new Error(`Instantly campaign creation did not return a campaign id: ${JSON.stringify(createResult).slice(0, 1000)}`);
    }
    campaignCreated = true;
  }

  const campaignId = campaign.id;

  // Enforce no-launch. If the newly created/existing campaign is active, immediately pause it before loading leads.
  const liveCampaign = await connector.execute({ action: "GET_CAMPAIGN", payload: { campaign_id: campaignId } });
  const liveCampaignObject = liveCampaign?.campaign || liveCampaign?.result || campaign;
  if (Number(liveCampaignObject?.status) === 1 && rules.safety?.ensurePausedAfterCreate) {
    await connector.execute({ action: "PAUSE_CAMPAIGN", payload: { campaign_id: campaignId, reason: "P1.3K no-launch safety gate" } });
  }

  const uploadResults = [];
  for (const row of leads) {
    const payload = buildLeadPayload(row, campaignId);
    if (!payload.email) continue;
    try {
      const result = await connector.execute({ action: "CREATE_LEAD", payload });
      uploadResults.push({ email: payload.email, ok: result?.ok !== false, result });
    } catch (error) {
      uploadResults.push({ email: payload.email, ok: false, error: error.message });
    }
  }

  const finalCampaignResult = await connector.execute({ action: "GET_CAMPAIGN", payload: { campaign_id: campaignId } });
  const finalCampaign = finalCampaignResult?.campaign || finalCampaignResult?.result || {};

  const summary = {
    ok: true,
    gate: rules.gate,
    state: rules.state,
    campaignName: rules.campaignName,
    campaignId,
    campaignCreated,
    senderEmails,
    verifiedLeadRows: leads.length,
    uploadSucceeded: uploadResults.filter(x => x.ok).length,
    uploadFailed: uploadResults.filter(x => !x.ok).length,
    finalCampaignStatus: finalCampaign?.status ?? null,
    activated: Number(finalCampaign?.status) === 1,
    safety: {
      activationAuthorized: false,
      activationAttempted: false,
      deleteAttempted: false
    }
  };

  const outDir = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "LIVE_EXECUTION");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "STATE_SLED_FL_LIVE_EXECUTION_RESULT.json"), JSON.stringify({ summary, uploadResults }, null, 2));

  if (summary.activated) {
    throw new Error("P1.3K safety violation: campaign is active after no-launch execution.");
  }

  return summary;
}

module.exports = {
  run,
  selectHealthySenders,
  buildCampaignPayload,
  buildLeadPayload
};
