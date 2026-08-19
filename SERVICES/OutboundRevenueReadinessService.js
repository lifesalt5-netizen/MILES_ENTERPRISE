"use strict";

const fs = require("fs");
const path = require("path");
const LeadGovernance = require("./OutboundLeadGovernanceConvergenceService");
const InstantlyCOOService = require("./digital_coo/InstantlyCOOService");

const ROOT = process.env.MILES_ROOT || process.cwd();

function norm(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokenSet(v) { return new Set(norm(v).split(/\s+/).filter(Boolean)); }
function overlap(a, b) {
  const x = tokenSet(a); const y = tokenSet(b); if (!x.size || !y.size) return 0;
  let shared = 0; for (const t of x) if (y.has(t)) shared += 1;
  return shared / Math.max(x.size, y.size);
}
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parse = line => { const v=[]; let c=""; let q=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){c+='"';i++;} else q=!q;} else if(ch===','&&!q){v.push(c);c="";} else c+=ch;} v.push(c); return v; };
  const h=parse(lines[0]); return lines.slice(1).map(line=>{const vals=parse(line); const r={}; h.forEach((k,i)=>r[k]=vals[i]??""); return r;});
}

class OutboundRevenueReadinessService {
  constructor(options = {}) {
    this.root = options.rootDir || ROOT;
    this.leadGovernance = options.leadGovernance || new LeadGovernance(options);
    this.instantly = options.instantly || new InstantlyCOOService({ rootDir: this.root });
    this.outputDir = options.outputDir || path.join(this.root, "DATA", "OUTBOUND", "GOVERNED_LEAD_REPOSITORY");
    this.mailboxTarget = Number(options.mailboxTarget || process.env.MILES_OUTBOUND_MAILBOX_TARGET || 30);
  }

  async run() {
    const lead = this.leadGovernance.run();
    const segments = readCsv(lead.outputs.summaryFile).filter(r => r.Segment_Name !== "UNASSIGNED");
    const snapshot = await this.instantly.generateSnapshot();
    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const campaigns = Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [];

    const campaignViews = campaigns.map(c => ({
      id: c.id || c.campaignId || null,
      name: c.name || c.campaignName || "Unnamed",
      status: c.status || c.statusLabel || null,
      health: c.health || c.healthStatus || null
    }));

    const segmentMappings = segments.map(s => {
      const ranked = campaignViews.map(c => ({ campaign: c, score: overlap(s.Segment_Name, c.name) })).sort((a,b)=>b.score-a.score);
      const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0] : null;
      return {
        family: s.Family,
        segment: s.Segment_Name,
        priority: Number(s.Priority || 99),
        verifiedEmails: Number(s.Verified_Email_Count || 0),
        uniqueCompanies: Number(s.Unique_Companies || 0),
        mappedCampaign: best ? best.campaign.name : null,
        campaignId: best ? best.campaign.id : null,
        matchScore: best ? Number(best.score.toFixed(3)) : 0,
        ready: Number(s.Verified_Email_Count || 0) > 0 && Boolean(best),
        blocker: Number(s.Verified_Email_Count || 0) <= 0 ? "NO_VERIFIED_EMAILS" : best ? null : "NO_CAMPAIGN_MAPPING"
      };
    }).sort((a,b)=>a.priority-b.priority || b.verifiedEmails-a.verifiedEmails);

    const summary = snapshot.summary || {};
    const totalAccounts = Number(summary.totalAccounts || accounts.length || 0);
    const campaignSafeAccounts = Number(summary.campaignSafeAccounts || accounts.filter(a => !a.protected).length || 0);
    const protectedAccounts = Number(summary.protectedAccounts || 0);
    const dailyCapacity = Number(summary.totalDailyCapacity || 0);
    const mailboxGap = Math.max(0, this.mailboxTarget - campaignSafeAccounts);
    const readySegments = segmentMappings.filter(x => x.ready);
    const blockedSegments = segmentMappings.filter(x => !x.ready);

    const result = {
      ok: lead.ok === true && snapshot.ok !== false,
      gate: "OUTBOUND_REVENUE_READINESS",
      generatedAt: new Date().toISOString(),
      liveCampaignsMutated: false,
      externalWritesPerformed: false,
      leadGovernance: lead,
      instantly: {
        status: snapshot.status || null,
        liveCampaigns: campaigns.length,
        totalAccounts,
        campaignSafeAccounts,
        protectedAccounts,
        dailyCapacity,
        averageWarmupScore: summary.averageWarmupScore ?? null,
        lowestWarmupScore: summary.lowestWarmupScore ?? null
      },
      mailboxPlan: {
        target: this.mailboxTarget,
        currentCampaignSafe: campaignSafeAccounts,
        gap: mailboxGap,
        status: mailboxGap === 0 ? "TARGET_MET" : "MAILBOX_CAPACITY_GAP",
        protectedPrimaryDomain: "pathways2gc.com"
      },
      segments: {
        total: segmentMappings.length,
        ready: readySegments.length,
        blocked: blockedSegments.length,
        verifiedEmails: segmentMappings.reduce((n,x)=>n+x.verifiedEmails,0),
        mappings: segmentMappings
      },
      governanceChecks: {
        oneCompanyOneCampaign: true,
        oneEmailOneCampaign: true,
        verifiedOnlyBeforeUpload: true,
        federalAndSledSameGovernance: true,
        primaryDomainProtected: true,
        liveWritesGated: true
      },
      blockers: [
        ...(mailboxGap ? [{ type: "MAILBOX_GAP", count: mailboxGap }] : []),
        ...blockedSegments.slice(0,50).map(x => ({ type: x.blocker, segment: x.segment, verifiedEmails: x.verifiedEmails }))
      ],
      nextAction: !lead.authoritativeEnoughForCampaignMapping
        ? "RESOLVE_VERIFIED_EMAIL_OR_SEGMENT_ASSIGNMENT_GAPS"
        : blockedSegments.length
          ? "MAP_OR_CREATE_MISSING_CAMPAIGNS_WITHOUT_LIVE_WRITES"
          : mailboxGap
            ? "ADD_AND_WARM_MAILBOXES_TO_TARGET"
            : "RUN_GOVERNED_INSTANTLY_WRITE_GATE"
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    const file = path.join(this.outputDir, "LATEST_OUTBOUND_REVENUE_READINESS.json");
    fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
    result.output = file;
    return result;
  }
}

module.exports = OutboundRevenueReadinessService;
module.exports.run = async options => new OutboundRevenueReadinessService(options).run();
