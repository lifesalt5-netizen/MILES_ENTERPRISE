'use strict';

const fs = require('fs');
const V11Publisher = require('./B12_CONTROLLED_PUBLISHER_V11');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }
function escapeRegex(v) { return String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function workingSignal(text) {
  return /thinking|working on it|making changes|generating|updating your site|writing code|applying changes|creating .* page/i.test(String(text || ''));
}

function explicitCompletion(text) {
  return /\bI(?:'ve| have)? (?:created|updated|added|removed|changed|set|hid|hidden|deleted)\b|\bI created a new page\b|\b(?:page|change|changes|update) (?:is|are) (?:ready|complete|completed|updated|created|done)\b|\bdone[.!]?\b/i.test(String(text || ''));
}

const pageBuilds = {
  GSA_ZERO_SALES_PAGE: {
    name: 'GSA Zero-Sales Diagnostic',
    target: '/gsa-zero-sales-diagnostic',
    headline: 'Your GSA Schedule Should Not Be Shelfware.',
    cta: 'Review My GSA Revenue Gap',
    operations: [
      ['AUDIENCE', "On the existing 'GSA Zero-Sales Diagnostic' page only, add or update one concise 'Who this is for' section for GSA Schedule holders with zero or low sales, firms waiting for opportunities, and firms unsure whether pricing, offerings, agency targeting, visibility, or capture is blocking traction. Complete this section now. Do not change other pages."],
      ['EXAMINES', "On the existing 'GSA Zero-Sales Diagnostic' page only, add or update one concise 'What P2GC examines' section covering contract/offering position, verifiable sales or activity signals, agency/buyer alignment, category/acquisition-path fit, relevant opportunity or eBuy signals, verified competitive/incumbent context, pricing/positioning where appropriate, and immediate activation priorities. Complete this section now. Do not invent proof or metrics and do not change other pages."],
      ['DELIVERABLE', "On the existing 'GSA Zero-Sales Diagnostic' page only, add or update one concise deliverable section stating that the diagnostic identifies the strongest likely cause of underperformance, highest-priority corrective actions, a realistic near-term revenue pathway, and whether deeper activation work is warranted. Complete this section now. Do not invent proof or metrics and do not change other pages."],
      ['FAQ', "On the existing 'GSA Zero-Sales Diagnostic' page only, add the FAQ question exactly 'Will you guarantee sales?' and answer in substance that no government award can be guaranteed and P2GC provides evidence-based positioning, prioritization, activation, and execution support. Also add 'Is this another GSA compliance review?' and explain that compliance can matter but this diagnostic focuses on conversion into market activity. Complete these FAQs now. Do not change other pages."]
    ]
  },
  FEDERAL_REVENUE_GAP_PAGE: {
    name: 'Federal Revenue Gap Analysis',
    target: '/federal-revenue-gap-analysis',
    headline: 'Find the Gap Between Being Government-Ready and Actually Generating Revenue.',
    cta: 'Show Me My Revenue Gaps',
    operations: [
      ['AUDIENCE', "On the existing 'Federal Revenue Gap Analysis' page only, add or update one concise 'Who this is for' section for registered and capable firms asking which agencies buy what they sell, whether to prime, subcontract, pursue a vehicle, focus on SLED, or use a hybrid path, whether they are targeting the wrong opportunities, and what to do first. Complete this section now. Do not change other pages."],
      ['EXAMINES', "On the existing 'Federal Revenue Gap Analysis' page only, add or update one concise 'What P2GC examines' section covering capabilities and NAICS alignment, agency buying patterns, relevant awards and incumbent activity, vehicle/access position, certification leverage, prime/sub teaming paths, live/forecast/recompete signals where appropriate, and positioning blockers. Complete this section now. Do not invent proof or metrics and do not change other pages."],
      ['DELIVERABLE', "On the existing 'Federal Revenue Gap Analysis' page only, add or update one concise deliverable section covering pathway-status assessment, strongest buyer/agency alignment signals, key access/positioning gaps, the three highest-priority next actions, and the most realistic route to revenue. Complete this section now. Do not invent proof or metrics and do not change other pages."],
      ['DISTINCTION', "On the existing 'Federal Revenue Gap Analysis' page only, include the exact sentence 'This is not a generic opportunity dump.' Immediately explain that P2GC first determines where the company can realistically compete and then uses opportunity intelligence inside that pathway. Complete this change now. Do not change other pages."]
    ]
  },
  RECOMPETE_VEHICLE_PAGE: {
    name: 'Recompete & Vehicle Growth Scan',
    target: '/recompete-vehicle-growth-scan',
    headline: 'Get Positioned Before the Opportunity Becomes a Last-Minute Bid.',
    cta: 'Run My Growth Scan',
    operations: [
      ['AUDIENCE', "On the existing 'Recompete & Vehicle Growth Scan' page only, add or update one concise 'Who this is for' section for established or growth-oriented contractors that need to understand relevant upcoming recompetes, incumbent context, vehicle access, teaming paths, and what to position before solicitation. Complete this section now. Do not change other pages."],
      ['EXAMINES', "On the existing 'Recompete & Vehicle Growth Scan' page only, add or update one concise 'What P2GC examines' section covering relevant expiring contracts and recompete timing, incumbent context, contract vehicles and access requirements, set-aside/certification context, agency alignment, probable prime-versus-team path, strategic fit, and capture priority. Complete this section now. Do not invent proof or metrics and do not change other pages."],
      ['LABELS', "On the existing 'Recompete & Vehicle Growth Scan' page only, add the recommendation labels exactly: PRIME, TEAM, POSITION EARLY, MONITOR, PASS. State that each recommendation is based on verifiable evidence rather than generic keyword matching. Complete this change now. Do not change other pages."],
      ['DISCLAIMER', "On the existing 'Recompete & Vehicle Growth Scan' page only, state clearly that a modeled recompete is not a confirmed procurement event and that P2GC does not invent quantified proof. Complete this change now. Do not change other pages."]
    ]
  }
};

class B12ControlledPublisherV12 extends V11Publisher {
  applyCompactPrompts() {
    if (!this.manifest || !Array.isArray(this.manifest.operations)) return;
    const operations = [];

    for (const op of this.manifest.operations) {
      const build = pageBuilds[op.id];
      if (!build) {
        operations.push(op);
        continue;
      }

      operations.push({
        ...op,
        id: `${op.id}_SCAFFOLD`,
        type: 'AI_AGENT_ATOMIC_PAGE_CREATE',
        target: build.target,
        required_markers: [],
        prompt: `Add a new page called '${build.name}' to my site.`,
        phase: 'SCAFFOLD',
        atomicProviderPrompt: true
      });
      operations.push({
        ...op,
        id: `${op.id}_HEADLINE`,
        type: 'AI_AGENT_ATOMIC_CONTENT',
        target: build.target,
        required_markers: [build.headline],
        prompt: `On the existing '${build.name}' page only, set the main hero headline exactly to '${build.headline}' Complete this one change now. Do not change other pages.`,
        phase: 'HEADLINE',
        atomicProviderPrompt: true
      });
      operations.push({
        ...op,
        id: `${op.id}_CTA`,
        type: 'AI_AGENT_ATOMIC_CONTENT',
        target: build.target,
        required_markers: [build.cta],
        prompt: `On the existing '${build.name}' page only, set the primary CTA text exactly to '${build.cta}'. Preserve the existing functional form or destination unless it is broken. Complete this one change now. Do not change other pages.`,
        phase: 'CTA',
        atomicProviderPrompt: true
      });

      for (const [suffix, prompt] of build.operations) {
        operations.push({
          ...op,
          id: `${op.id}_${suffix}`,
          type: 'AI_AGENT_ATOMIC_CONTENT',
          target: build.target,
          required_markers: [],
          prompt,
          phase: suffix,
          atomicProviderPrompt: true
        });
      }

      operations.push({
        ...op,
        id: `${op.id}_NAV_HIDE`,
        type: 'AI_AGENT_ATOMIC_NAV_CLEANUP',
        target: build.target,
        required_markers: [],
        prompt: `Remove the '${build.name}' page from the main navigation. Keep the page itself and its content. Do not change any other page.`,
        phase: 'NAV_HIDE',
        atomicProviderPrompt: true
      });
    }

    this.manifest = { ...this.manifest, operations };
  }

  seedIds() {
    const ids = new Set(super.seedIds());
    if (this.manifest?.site === 'pathways2gc.com') {
      // Confirmed by the 2026-08-25 live B12 evidence: both pages exist and these exact headlines rendered.
      ids.add('GSA_ZERO_SALES_PAGE_SCAFFOLD');
      ids.add('GSA_ZERO_SALES_PAGE_HEADLINE');
      ids.add('FEDERAL_REVENUE_GAP_PAGE_SCAFFOLD');
      ids.add('FEDERAL_REVENUE_GAP_PAGE_HEADLINE');
    }
    return [...ids];
  }

  readLedger() {
    const ledger = super.readLedger();
    if (ledger?.operations) {
      // V11 falsely marked these broad operations green after B12 completed only the headline / requested a confirmation click.
      delete ledger.operations.GSA_ZERO_SALES_PAGE;
      delete ledger.operations.GSA_ZERO_SALES_PAGE_NAV_CLEANUP;
    }
    return ledger;
  }

  operationTimeoutMs(prompt) {
    const text = clean(prompt);
    if (/^Add a new page called/i.test(text)) return 15 * 60 * 1000;
    if (/^Remove the .* page from the main navigation/i.test(text)) return 5 * 60 * 1000;
    if (/^On the existing .* page only/i.test(text)) return 6 * 60 * 1000;
    return super.operationTimeoutMs(prompt);
  }

  operationLocalText(body) {
    const text = String(body || '');
    const prompt = clean(this._activePrompt);
    if (prompt) {
      const index = text.lastIndexOf(prompt);
      if (index >= 0) return text.slice(index + prompt.length);
    }
    return text.slice(-5000);
  }

  async waitForAgentSettled(timeoutMs = 6 * 60 * 1000) {
    const started = Date.now();
    let lastLocal = '';
    let stable = 0;
    let lastChangeAt = started;
    let lastHeartbeatBucket = -1;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const local = this.operationLocalText(body).slice(-6000);
      const recent = local.slice(-2500);
      const working = workingSignal(recent);
      const completed = explicitCompletion(recent);
      const asksForClick = /please click the button below|click the button below/i.test(recent);

      if (local !== lastLocal) lastChangeAt = Date.now();
      if (!working && local && local === lastLocal) stable += 1;
      else stable = 0;
      lastLocal = local;

      const elapsedMs = Date.now() - started;
      const noVisibleProgressMs = Date.now() - lastChangeAt;
      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS] elapsed=${Math.round(elapsedMs / 1000)}s operationLocal=true working=${working} explicitCompletion=${completed} actionRequired=${asksForClick} stable=${stable} lastChangeAgo=${Math.round(noVisibleProgressMs / 1000)}s`);
      }

      if (asksForClick && !working) {
        return {
          ok: false,
          status: 'AGENT_PROVIDER_ACTION_BUTTON_REQUIRED',
          actionRequired: true,
          elapsedMs,
          operationLocalEvidence: recent.slice(-1800)
        };
      }

      if (completed && !working && stable >= 1) {
        return {
          ok: true,
          status: 'AGENT_OPERATION_LOCAL_EXPLICIT_COMPLETION',
          elapsedMs,
          workingAtCompletion: false,
          operationLocalEvidence: recent.slice(-1800)
        };
      }

      if (!working && stable >= 2) {
        return {
          ok: false,
          status: 'AGENT_SETTLED_WITHOUT_OPERATION_COMPLETION_EVIDENCE',
          elapsedMs,
          operationLocalEvidence: recent.slice(-1800)
        };
      }

      if (working && noVisibleProgressMs >= 6 * 60 * 1000) {
        return {
          ok: false,
          status: 'AGENT_STALLED_OPERATION_LOCAL',
          stillWorking: true,
          elapsedMs,
          lastChangeAgoMs: noVisibleProgressMs,
          operationLocalEvidence: recent.slice(-1800)
        };
      }
    }

    return {
      ok: false,
      status: 'AGENT_OPERATION_LOCAL_MAX_WAIT',
      timeoutMs,
      elapsedMs: Date.now() - started,
      lastChangeAgoMs: Date.now() - lastChangeAt,
      operationLocalEvidence: lastLocal.slice(-1800)
    };
  }

  async findNavigationActionButton(prompt) {
    const match = clean(prompt).match(/^Remove the '([^']+)' page from the main navigation/i);
    if (!match) return null;
    const pageName = match[1];
    const exact = new RegExp(`^\\s*Remove\\s+${escapeRegex(pageName)}\\s+from\\s+navigation\\s*$`, 'i');
    const generic = /remove .* from navigation/i;

    for (const item of this.editorScopes()) {
      const candidates = [
        item.scope.getByRole('button', { name: exact }),
        item.scope.getByRole('button', { name: generic })
      ];
      for (const locator of candidates) {
        const found = await this.findVisibleInScope(item.scope, locator);
        if (found) return { button: found, scopeUrl: item.url, pageName };
      }
    }
    return null;
  }

  async sendAgentPrompt(prompt) {
    this._activePrompt = clean(prompt);
    const first = await super.sendAgentPrompt(prompt);

    const navPrompt = /^Remove the '([^']+)' page from the main navigation/i.test(this._activePrompt);
    if (!navPrompt) return first;

    let action = await this.findNavigationActionButton(this._activePrompt);
    if (!action && first?.actionRequired) {
      const started = Date.now();
      while (!action && Date.now() - started < 20000) {
        await sleep(1000);
        action = await this.findNavigationActionButton(this._activePrompt);
      }
    }

    if (!action) {
      if (first?.ok) return first;
      return {
        ...first,
        ok: false,
        status: first?.actionRequired ? 'AGENT_NAVIGATION_ACTION_BUTTON_NOT_FOUND' : first?.status,
        navigationActionExpected: true
      };
    }

    await action.button.click();
    await sleep(1800);
    return {
      ok: true,
      status: 'AGENT_NAVIGATION_ACTION_BUTTON_CLICKED',
      actionButtonClicked: true,
      pageName: action.pageName,
      scopeUrl: action.scopeUrl,
      priorAgentStatus: first?.status || null,
      operationLocalEvidence: first?.operationLocalEvidence || null
    };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V12_DURABLE_RESUME_OPERATION_LOCAL_ATOMIC';
      result.promptStrategy = 'OPERATION_LOCAL_ATOMIC_CONTENT_WITH_CONFIRMED_NAV_ACTIONS';
      result.completionPolicy = {
        operationLocalResponseOnly: true,
        stalePriorChatCannotSatisfyCurrentOperation: true,
        broadContentSplitIntoAtomicOperations: true,
        navigationConfirmationButtonsClickedByMiles: true,
        publicPublishRemainsGated: true,
        migratedLiveSuccessIds: this.manifest?.site === 'pathways2gc.com'
          ? ['GSA_ZERO_SALES_PAGE_SCAFFOLD', 'GSA_ZERO_SALES_PAGE_HEADLINE', 'FEDERAL_REVENUE_GAP_PAGE_SCAFFOLD', 'FEDERAL_REVENUE_GAP_PAGE_HEADLINE']
          : []
      };
      result.correctedPriorFalsePositiveIds = ['GSA_ZERO_SALES_PAGE', 'GSA_ZERO_SALES_PAGE_NAV_CLEANUP'];
      try {
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

if (require.main === module) {
  const publisher = new B12ControlledPublisherV12();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  publisher.run({ apply, publish }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = B12ControlledPublisherV12;
