"use strict";

const fs = require("fs");
const path = require("path");
const ProviderRegistry = require("./ProviderRegistry");

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    let raw = fs.readFileSync(file, "utf8");
    raw = raw.replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function emailDomain(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1) : "";
}

class RevenueMissionSourceService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..");

    this.sourceFiles = options.sourceFiles || [
      { source: "revenue_work_queue", file: path.join(this.rootDir, "DATA", "revenue", "revenue_work_queue.json") },
      { source: "crm_followups", file: path.join(this.rootDir, "DATA", "revenue", "crm_followups.json") },
      { source: "proposal_deadlines", file: path.join(this.rootDir, "DATA", "revenue", "proposal_deadlines.json") },
      { source: "client_deliverables", file: path.join(this.rootDir, "DATA", "revenue", "client_deliverables.json") },
      { source: "orion_recommendations", file: path.join(this.rootDir, "DATA", "revenue", "orion_recommendations.json") },
      { source: "qualified_replies", file: path.join(this.rootDir, "DATA", "runtime", "revenue", "replies", "qualified_reply_queue.json") },
      { source: "replacement_contacts", file: path.join(this.rootDir, "DATA", "runtime", "revenue", "replies", "replacement_contact_queue.json") }
    ];
  }

  extractItems(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const possibleArrays = [value.operations,value.items,value.workItems,value.missions,value.followups,value.deadlines,value.deliverables,value.recommendations];
    return possibleArrays.find(Array.isArray) || [];
  }

  prepareReplacementContact(item = {}, source = "") {
    if (source !== "replacement_contacts") return item;

    const replacementEmail = String(item.replacementEmail || item.email || "").trim().toLowerCase();
    const departedEmail = String(item.departedContactEmail || "").trim().toLowerCase();
    const replacementDomain = emailDomain(replacementEmail);
    const departedDomain = emailDomain(departedEmail);
    const sameOrganizationDomain = Boolean(replacementDomain && departedDomain && replacementDomain === departedDomain);
    const explicitRedirect = item.evidenceType === "EXPLICIT_REPLACEMENT_CONTACT_NOTICE" && item.detected === true;
    const campaignId = String(item.campaignId || item.campaign || "").trim();
    const executable = explicitRedirect && sameOrganizationDomain && Boolean(replacementEmail) && Boolean(campaignId);

    return {
      ...item,
      title: item.title || `Replace departed contact with ${replacementEmail || "verified replacement"}`,
      objective: item.objective || "Retire the departed contact and continue the existing campaign with the explicitly supplied replacement contact.",
      reason: item.reason || "The recipient's own mailbox explicitly supplied a replacement contact.",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      system: "INSTANTLY",
      department: "Revenue Operations",
      action: executable ? "createLead" : "VERIFY_REPLACEMENT_CONTACT",
      type: executable ? "createLead" : "VERIFY_REPLACEMENT_CONTACT",
      capability: executable ? "INSTANTLY_CREATE_LEAD" : "VERIFY_REPLACEMENT_CONTACT",
      email: replacementEmail,
      campaign: campaignId,
      campaignId,
      contactEmail: replacementEmail,
      contactName: item.replacementName || "",
      sourceVerification: explicitRedirect ? "EXPLICIT_COMPANY_REDIRECT" : "UNVERIFIED",
      sameOrganizationDomain,
      dedupeKey: `${replacementEmail}|${campaignId}`,
      custom_variables: {
        ...(item.custom_variables || {}),
        replacement_of: departedEmail,
        source: "INSTANTLY_REPLACEMENT_CONTACT_NOTICE",
        source_email_id: item.sourceEmailId || ""
      },
      requiresKevin: false,
      status: executable ? "READY" : "VERIFICATION_REQUIRED",
      nextAction: executable ? "CREATE_REPLACEMENT_LEAD_IN_EXISTING_CAMPAIGN" : "VERIFY_REPLACEMENT_CONTACT",
      requiredGates: ["EXPLICIT_REDIRECT_EVIDENCE","SAME_ORGANIZATION_DOMAIN","GLOBAL_SUPPRESSION_CHECK","QUEUE_DEDUPE","PRESERVE_CAMPAIGN_CONTEXT","CREATE_REPLACEMENT_LEAD"]
    };
  }

  inferRevenueStage(item = {}, source = "") {
    const explicit = item.revenueStage || item.stage || item.pipelineStage;
    if (explicit) return String(explicit).toUpperCase();
    if (source === "qualified_replies") return "INTERESTED_REPLY";
    if (source === "replacement_contacts") return "PIPELINE";
    const text = [source,item.title,item.objective,item.reason,item.description,item.action,item.type,item.status].filter(Boolean).join(" ").toLowerCase();
    if (/interested|positive reply|responded lead|hot lead/.test(text)) return "INTERESTED_REPLY";
    if (/proposal|quote|pricing/.test(text)) return "PROPOSAL";
    if (/meeting|appointment|discovery call/.test(text)) return "MEETING";
    if (/contract|negotiation|close deal/.test(text)) return "NEGOTIATION";
    if (/client|deliverable|fulfillment/.test(text)) return "CLIENT_DELIVERY";
    if (/campaign|instantly|outbound|lead list/.test(text)) return "PIPELINE";
    return "PIPELINE";
  }

  inferProvider(item = {}, source = "") {
    if (item.provider) return item.provider;
    if (item.connector) return item.connector;
    if (item.system) return item.system;
    const text = [source,item.title,item.action,item.objective].filter(Boolean).join(" ").toLowerCase();
    if (/instantly|campaign|outbound|replacement_contacts|qualified_replies/.test(text)) return "INSTANTLY";
    if (/orion|opportunity|recompete/.test(text)) return "ORION";
    if (/email|gmail|workspace/.test(text)) return "GOOGLE";
    return "MILES";
  }

  inferAction(item = {}, stage = "") {
    if (item.action) return item.action;
    if (item.type) return item.type;
    const actions = {INTERESTED_REPLY:"PREPARE_PROSPECT_RESPONSE",MEETING:"PREPARE_MEETING_FOLLOWUP",PROPOSAL:"PREPARE_PROPOSAL_ACTION",NEGOTIATION:"PREPARE_CLOSE_ACTION",CLIENT_DELIVERY:"COMPLETE_CLIENT_DELIVERABLE",PIPELINE:"ADVANCE_REVENUE_PIPELINE"};
    return actions[stage] || "ADVANCE_REVENUE_PIPELINE";
  }

  defaultMetrics(stage) {
    const metrics = {
      INTERESTED_REPLY:{expectedRevenue:90,urgency:100,customerImpact:90,strategicValue:95,executionConfidence:90},
      NEGOTIATION:{expectedRevenue:100,urgency:95,customerImpact:90,strategicValue:100,executionConfidence:80},
      PROPOSAL:{expectedRevenue:85,urgency:90,customerImpact:85,strategicValue:90,executionConfidence:80},
      MEETING:{expectedRevenue:75,urgency:85,customerImpact:80,strategicValue:85,executionConfidence:90},
      CLIENT_DELIVERY:{expectedRevenue:70,urgency:90,customerImpact:100,strategicValue:90,executionConfidence:90},
      PIPELINE:{expectedRevenue:55,urgency:60,customerImpact:55,strategicValue:75,executionConfidence:80}
    };
    return metrics[stage] || metrics.PIPELINE;
  }

  normalizeItem(rawItem = {}, source = "", file = "", index = 0) {
    const item = this.prepareReplacementContact(rawItem, source);
    const title = item.title || item.command || item.objective || item.description || "Advance revenue opportunity";
    const objective = item.objective || item.description || item.reason || title;
    const revenueStage = this.inferRevenueStage(item, source);
    const defaults = this.defaultMetrics(revenueStage);
    const action = this.inferAction(item, revenueStage);
    const provider = this.inferProvider(item, source);
    const sourceKey = [source,item.id || "",item.contactEmail || item.email || "",item.company || item.client || "",title,item.dueDate || item.deadline || ""].join("|");
    const generatedId = "REVENUE_" + Buffer.from(sourceKey, "utf8").toString("base64url").slice(0,72);
    const requiresKevin = item.requiresKevin === true || item.requiresCEO === true || item.approvalRequired === true || ["SEND_PROPOSAL","APPROVE_PRICING","CHANGE_PRICING","SIGN_CONTRACT","SPEND_MONEY"].includes(String(action).toUpperCase());
    let status = String(item.status || (requiresKevin ? "AWAITING_APPROVAL" : "READY")).toUpperCase();
    if (requiresKevin && ["READY","PENDING","NEW"].includes(status)) status = "AWAITING_APPROVAL";

    return {
      ...item,
      id:item.id || generatedId,
      source,sourceQueue:file,sourceIndex:index,
      department:item.department || "Revenue Operations",
      provider,
      connector:item.connector || provider,
      system:item.system || provider,
      action,
      capability:item.capability || action,
      type:item.type || action,
      title,
      command:item.command || title,
      objective,
      reason:item.reason || objective,
      revenueStage,
      expectedRevenue:Number(item.expectedRevenue ?? item.revenueImpact ?? defaults.expectedRevenue),
      urgency:Number(item.urgency ?? defaults.urgency),
      customerImpact:Number(item.customerImpact ?? defaults.customerImpact),
      strategicValue:Number(item.strategicValue ?? defaults.strategicValue),
      executionConfidence:Number(item.executionConfidence ?? item.confidence ?? defaults.executionConfidence),
      risk:Number(item.risk ?? 10),
      priority:Number(item.priority ?? 1),
      requiresKevin,
      requiresCEO:requiresKevin,
      status,
      dueDate:item.dueDate || item.deadline || null,
      importedAt:item.importedAt || now(),
      updatedAt:now(),
      metadata:{...(item.metadata || {}),revenueStage,source,sourceFile:file}
    };
  }

  readCandidates() {
    const candidates=[];
    const sourceSummary=[];
    for(const definition of this.sourceFiles){
      const raw=readJson(definition.file,[]);
      const items=this.extractItems(raw);
      sourceSummary.push({source:definition.source,file:definition.file,found:items.length});
      items.forEach((item,index)=>candidates.push(this.normalizeItem(item,definition.source,definition.file,index)));
    }
    return {candidates,sourceSummary};
  }
}

module.exports = RevenueMissionSourceService;
module.exports.emailDomain = emailDomain;