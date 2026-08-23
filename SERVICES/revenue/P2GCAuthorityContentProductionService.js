'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function clean(v) { return String(v || '').trim(); }
function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function approvedProof(registry, id) {
  if (!id) return null;
  const rows = [...(registry.approved || []), ...(registry.candidates || [])];
  const row = rows.find(x => x.id === id);
  if (!row) return null;
  const approved = clean(row.status).toUpperCase() === 'APPROVED' && clean(row.public_use).toUpperCase() === 'APPROVED' && !['', 'UNKNOWN', 'PENDING'].includes(clean(row.permission_status).toUpperCase());
  return approved ? row : null;
}

function methodologyDraft(item) {
  const title = item.linkedin_title || item.title || item.theme;
  const theme = clean(item.theme).toLowerCase();
  let linkedin;
  let video;
  let email = null;

  if (theme.includes('gsa shelfware')) {
    linkedin = `Getting the Schedule is not the same as building a federal revenue path.\n\nWhen a capable contractor holds a GSA Schedule but sees little or no traction, the first move should not automatically be to bid more. Validate offer alignment, buyer alignment, opportunity fit, vehicle activation, and capture execution.\n\nA contract vehicle creates access. It does not create demand, positioning, or capture discipline by itself.\n\nP2GC starts by identifying where the revenue path is breaking down and what should be worked first.\n\nCTA: ${item.cta}.`;
    video = `A GSA Schedule can be valuable and still produce very little revenue. Before telling a company to chase more bids, check what is actually being sold, which buyers are aligned, whether the opportunities truly fit, whether the Schedule is being activated as an acquisition path, and whether there is a repeatable capture process. The Schedule is access. The revenue strategy is everything around that access. CTA: ${item.cta}.`;
  } else if (theme.includes('vehicle activation')) {
    linkedin = `A government contract vehicle answers one important question: can a buyer use this acquisition path to purchase from you?\n\nIt does not automatically tell you which agencies to target, which buyers are aligned, which opportunities deserve capture resources, whether you should prime or team, or whether your offering matches the way the government buys.\n\nThink of the vehicle as infrastructure. Activation connects that infrastructure to verified demand.\n\nVerify access → verify market alignment → identify the gap → prioritize the path → execute.\n\nCTA: ${item.cta}.`;
    video = `Getting a vehicle award should not be treated as the finish line. The award creates an acquisition path. It does not create agency targeting, buyer alignment, opportunity qualification, or capture strategy. A useful activation plan connects the vehicle to verified demand and tells you what to do first. CTA: ${item.cta}.`;
  } else if (theme.includes('federal revenue gap')) {
    linkedin = `SAM registration makes a company eligible to participate. It does not create a market strategy.\n\nBefore increasing bid volume, answer three questions: Who is actually buying what you sell? What acquisition path can realistically reach those buyers? Which pursuits fit your capability, access, timing, and competitive position?\n\nIf those answers are unclear, the problem is not a lack of opportunity notices. It is a revenue-path gap.\n\nCTA: ${item.cta}.`;
    video = `Three questions every SAM-registered company should answer before bidding: who buys what you sell, how can they realistically buy from you, and which pursuits fit your capability and position? Registration is eligibility. Market strategy is the path from that eligibility to qualified demand. CTA: ${item.cta}.`;
  } else if (theme.includes('pathway selection')) {
    linkedin = `More opportunities can make results worse when the targeting logic is wrong.\n\nEvery pursuit consumes attention, capture time, pricing effort, partner bandwidth, and proposal resources. The better first decision is the pathway: prime, subcontract, use a vehicle, pursue SLED, or combine paths.\n\nThen filter opportunities inside that pathway.\n\nOpportunity volume is not the goal. Qualified revenue paths are.\n\nCTA: ${item.cta}.`;
    video = `Prime, subcontract, vehicle, SLED, or hybrid? Choose the path before choosing the bid. Start with buyer demand, acquisition access, past performance, delivery capability, competitive position, and timing. Then decide where opportunity search belongs. CTA: ${item.cta}.`;
  } else if (theme.includes('agency alignment')) {
    linkedin = `A real agency-alignment analysis should do more than list agencies with large budgets. It should connect your actual capabilities to verified buying history, relevant buyers, acquisition paths, competitive context, and current or future demand signals.\n\nThe output should help answer where to focus and what to do next—not simply produce a longer opportunity list.\n\nCTA: ${item.cta}.`;
    video = `An opportunity list answers what is posted. A revenue pathway asks who buys, how they buy, whether you can access that path, how you should position, and which opportunities deserve resources. The pathway should come before the list. CTA: ${item.cta}.`;
    email = `Subject: ${item.email_title || title}\n\nWhere is the government actually buying what you sell?\n\nA useful agency-alignment review connects capabilities to buying history, buyers, access paths, competition, and current demand signals. It should narrow focus, not create noise.\n\nP2GC uses that logic to determine the most realistic next pathway before expanding pursuit volume.\n\nCTA: ${item.cta}.`;
  } else if (theme.includes('recompete timing')) {
    linkedin = `By the time a solicitation is released, many important positioning decisions may already be constrained.\n\nEarly capture means validating the requirement, incumbent context where authoritative, acquisition vehicle, likely access path, customer alignment, partner options, and timing before the bid window becomes the only thing that matters.\n\nA modeled recompete signal is a watch item until authoritative procurement evidence confirms it.\n\nCTA: ${item.cta}.`;
    video = `Before an incumbent contract recompetes, know the requirement, customer, acquisition path, incumbent context where verified, timing, likely competition, and whether you should prime, team, position, monitor, or pass. A modeled signal is not a confirmed procurement. CTA: ${item.cta}.`;
  } else if (theme.includes('prime vs teaming')) {
    linkedin = `There are at least five useful decisions a contractor can make about a growth path: PRIME, TEAM, POSITION EARLY, MONITOR, or PASS.\n\nThat is more useful than forcing every opportunity into GO or NO-GO.\n\nThe right decision depends on access, past performance, buyer relationship, scope fit, vehicle position, competitive reality, delivery capacity, and timing.\n\nCTA: ${item.cta}.`;
    video = `Subcontracting can be the smarter growth strategy when the prime path is structurally weak but your capability is valuable to a contractor that already has access, customer position, or past performance. Teaming is not a consolation prize; it can be the highest-probability route to revenue. CTA: ${item.cta}.`;
  } else if (theme.includes('timing/vehicle/incumbent')) {
    linkedin = `Capture strategy changes when you add three pieces of evidence: timing, vehicle access, and incumbent context.\n\nThe same requirement may be a PRIME target for one company, a TEAM target for another, a POSITION EARLY item for a third, and a PASS for everyone else.\n\nThe purpose of intelligence is not to make every opportunity look attractive. It is to make the decision more accurate.\n\nCTA: ${item.cta}.`;
    video = `Vehicle access changes who can realistically compete because acquisition paths determine who the buyer can efficiently purchase from. Combine access with timing, incumbent context, and company fit before deciding how to pursue. CTA: ${item.cta}.`;
    email = `Subject: ${item.email_title || title}\n\nGet positioned before the RFP.\n\nEarly capture should validate timing, access, incumbent context where authoritative, buyer alignment, and prime-versus-team strategy before the solicitation compresses your options.\n\nP2GC separates verified procurement evidence from modeled watch signals so planning does not become fiction.\n\nCTA: ${item.cta}.`;
  } else if (theme.includes('federal pathway validation')) {
    linkedin = `Federal Pathway Validation starts with market truth, not an opportunity search.\n\nWe want to know whether the company is correctly registered, whether there is relevant buying history, whether access exists, which buyers align, what current demand signals are supportable, and whether prime, teaming, vehicle, SLED, or another route is most realistic.\n\nOnly then should pursuit volume expand.\n\nCTA: ${item.cta}.`;
    video = `We do not start with opportunities. We start with market truth: identity, demand, access, buyer alignment, fit, timing, teaming, and capture maturity. The purpose is to find the executable path before spending money chasing notices. CTA: ${item.cta}.`;
  } else if (theme.includes('market intelligence')) {
    linkedin = `Before a contractor spends money on capture, useful market intelligence should answer: Is there verified demand? Can this company access the buying path? What is the strongest realistic route—prime, team, vehicle, SLED, position early, monitor, or pass?\n\nIf the intelligence cannot change a decision, it is probably just information.\n\nCTA: ${item.cta}.`;
    video = `Three signals a contractor may be positioned but blocked: the company is eligible but lacks buyer alignment, it has access but no qualified opportunity path, or it has demand signals but the prime/team strategy is unresolved. Intelligence should identify the blocker and the next action. CTA: ${item.cta}.`;
  } else if (theme.includes('proof and prioritization')) {
    linkedin = `A useful government-growth plan should tell a contractor what to work first—and what not to work yet.\n\nP2GC prioritizes evidence: foundation, demand, access, buyer alignment, opportunity fit, teaming/recompete timing where verified, and capture process.\n\nThe goal is an ordered next-action path rather than a stack of disconnected recommendations.\n\nCTA: ${item.cta}.`;
    video = `How does P2GC decide what a contractor should work first? We identify the highest-impact verified blocker in the path to revenue and sequence the next actions around it. Fixing the wrong problem faster is still the wrong problem. CTA: ${item.cta}.`;
    email = `Subject: ${item.email_title || title}\n\nFrom eligibility to an executable revenue path.\n\nThe useful question is not whether a company can technically participate in government contracting. It is which verified blocker should be solved first: foundation, demand, access, buyer alignment, opportunity fit, teaming/timing, or capture execution.\n\nP2GC's pathway approach turns those findings into an ordered next-action plan.\n\nCTA: ${item.cta}.`;
  } else {
    linkedin = `${title}\n\nP2GC approaches this topic by separating verified evidence from assumptions and turning the finding into a practical next action.\n\nCTA: ${item.cta}.`;
    video = `${item.video_title || title}. Verify the evidence, identify the decision it changes, and connect it to the next executable revenue-path action. CTA: ${item.cta}.`;
  }

  return { linkedin, video, email };
}

function caseStudyFallback(item) {
  if (item.id === 'AUTH-20260828-GSA-CASE') {
    return {
      linkedin: `The scheduled case study for today is intentionally not being published as a client-outcome story yet.\n\nIf we cannot retain the evidence behind a timeframe, award, opportunity value, or other outcome, we should not use it as marketing proof.\n\nSo here is the useful part instead: what P2GC checks before telling a GSA holder to bid more.\n\nWe validate the company and vehicle position, authoritative sales/award signals where available, agency and buyer alignment, current opportunity fit, potential teaming/access gaps, early recompete signals without representing modeled intelligence as confirmed procurement, and the actual capture process.\n\nOnly then should the recommendation become: activate, target, pursue, team, position early, monitor, or pass.\n\nCTA: ${item.cta}.`,
      video: `Before I tell a GSA holder to bid more, I want evidence. Is the vehicle active and relevant? Is there verified sales history? Are the right buyers aligned? Are opportunities actually a fit? Is teaming more realistic? Are we looking at a confirmed procurement signal or a modeled watch item? The objective is not more bidding. It is a more executable revenue path. CTA: ${item.cta}.`,
      email: `Subject: ${item.email_title}\n\nA GSA Schedule can solve an access problem without solving a revenue problem.\n\nWhen traction is weak, separate vehicle fit, agency/buyer alignment, opportunity fit, prime-versus-team strategy, and capture execution before adding more bids.\n\nA vehicle should be part of a revenue system, not a credential that sits on a capability statement.\n\nCTA: ${item.cta}.`
    };
  }
  return methodologyDraft({ ...item, theme: 'proof and prioritization' });
}

class P2GCAuthorityContentProductionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.schedulePath = options.schedulePath || path.join(this.rootDir, 'CONFIG', 'p2gc_authority_content_schedule.json');
    this.proofPath = options.proofPath || path.join(this.rootDir, 'DATA', 'marketing_coo', 'p2gc_proof_registry.json');
    this.schedule = options.schedule || readJson(this.schedulePath, { items: [] });
    this.proof = options.proof || readJson(this.proofPath, { approved: [], candidates: [] });
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'authority_content');
  }

  classify(item) {
    const mode = clean(item.evidence_mode).toUpperCase();
    if (mode === 'CASE_STUDY') {
      const proof = approvedProof(this.proof, item.proof_id);
      if (proof) return { status: 'READY_PROOF_APPROVED', proof };
      if (clean(item.fallback_mode).toUpperCase() === 'METHODOLOGY_ONLY') {
        return { status: 'READY_METHODOLOGY_FALLBACK', proof: null, blockReason: 'CASE_STUDY_PROOF_NOT_APPROVED' };
      }
      return { status: 'BLOCKED_PROOF_REQUIRED', proof: null, blockReason: 'CASE_STUDY_PROOF_NOT_APPROVED' };
    }
    if (mode === 'INTERNAL_DATA_REQUIRED') {
      return { status: 'BLOCKED_DATASET_VALIDATION_REQUIRED', proof: null, blockReason: 'INTERNAL_DATASET_MUST_BE_VALIDATED_BEFORE_PUBLICATION' };
    }
    return { status: 'READY_METHODOLOGY', proof: null };
  }

  drafts(item, classification) {
    if (classification.status === 'READY_METHODOLOGY_FALLBACK') return caseStudyFallback(item);
    if (classification.status.startsWith('BLOCKED_')) return { linkedin: null, video: null, email: null };
    return methodologyDraft(item);
  }

  produce(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const horizonDays = Number(options.horizonDays ?? 30);
    const startMs = now.getTime() - 86400000;
    const endMs = now.getTime() + horizonDays * 86400000;
    const items = [];

    for (const item of this.schedule.items || []) {
      const dateMs = Date.parse(`${item.date}T12:00:00Z`);
      if (!Number.isFinite(dateMs) || dateMs < startMs || dateMs > endMs) continue;
      const classification = this.classify(item);
      const drafts = this.drafts(item, classification);
      const channels = [];
      if (item.asset_type === 'WEBINAR') channels.push('WEBINAR');
      else if (item.asset_type === 'DEEP_ASSET') channels.push('DEEP_ASSET');
      else {
        if (item.linkedin_title) channels.push('LINKEDIN');
        if (item.video_title) channels.push('SHORT_VIDEO');
        if (item.email_title) channels.push('INTELLIGENCE_EMAIL');
      }
      items.push({
        ...item,
        production_status: classification.status,
        block_reason: classification.blockReason || null,
        approved_proof_id: classification.proof?.id || null,
        channels,
        drafts,
        publication_status: classification.status.startsWith('READY_') ? 'READY_FOR_CHANNEL_EXECUTION' : 'BLOCKED',
        attribution: {
          publication_date: null,
          content_id: item.id,
          topic_pain_family: item.theme,
          offer_cta: item.cta,
          impressions_or_views: 0,
          profile_or_site_visits: 0,
          diagnostic_starts: 0,
          diagnostic_completions: 0,
          booked_meetings: 0,
          proposals: 0,
          closes: 0,
          attributed_revenue: 0
        }
      });
    }

    const report = {
      ok: true,
      service: 'P2GC_AUTHORITY_CONTENT_PRODUCTION',
      generatedAt: now.toISOString(),
      horizonDays,
      totals: {
        items: items.length,
        ready: items.filter(x => x.publication_status === 'READY_FOR_CHANNEL_EXECUTION').length,
        blocked: items.filter(x => x.publication_status === 'BLOCKED').length,
        proofFallbacks: items.filter(x => x.production_status === 'READY_METHODOLOGY_FALLBACK').length
      },
      items,
      channelExecution: {
        linkedinConnectorAvailable: false,
        autoPublishPerformed: false,
        note: 'Production queue is ready; channel publication requires a governed publisher/connector and must not be inferred from content readiness.'
      },
      governance: {
        proofRegistryEnforced: true,
        unverifiedCaseStudiesBlockedOrFallback: true,
        internalDataAssetBlockedUntilDatasetValidation: true,
        onePrimaryCtaPerItem: true,
        revenueAttributionRequired: true
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'production_queue_latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = P2GCAuthorityContentProductionService;
module.exports.helpers = { readJson, clean, isoDate, approvedProof, methodologyDraft, caseStudyFallback };
