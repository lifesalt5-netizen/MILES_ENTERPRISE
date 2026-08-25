'use strict';

const V6Publisher = require('./B12_CONTROLLED_PUBLISHER_V6');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const compactPrompts = {
  GSA_ZERO_SALES_PAGE: "Create or update a page called 'GSA Zero-Sales Diagnostic' and hide it from navigation. It is for GSA Schedule holders with little or no sales. Match the existing P2GC site style. Use the exact headline 'Your GSA Schedule Should Not Be Shelfware.' Use primary CTA 'Review My GSA Revenue Gap'. Include concise sections for who it is for, what P2GC examines, what the client receives, and an FAQ containing 'Will you guarantee sales?' with the answer that government awards cannot be guaranteed. Do not invent proof or metrics.",
  FEDERAL_REVENUE_GAP_PAGE: "Create or update a page called 'Federal Revenue Gap Analysis' and hide it from navigation. It is for government-ready firms not generating enough federal revenue. Match the existing P2GC site style. Use the exact headline 'Find the Gap Between Being Government-Ready and Actually Generating Revenue.' Use primary CTA 'Show Me My Revenue Gaps'. Include concise sections covering buyer/agency alignment, access and positioning gaps, prime/sub/vehicle paths, and the three highest-priority next actions. Include the exact sentence 'This is not a generic opportunity dump.' Do not invent proof or metrics.",
  RECOMPETE_VEHICLE_PAGE: "Create or update a page called 'Recompete & Vehicle Growth Scan' and hide it from navigation. It is for established contractors that need to position before solicitations. Match the existing P2GC site style. Use the exact headline 'Get Positioned Before the Opportunity Becomes a Last-Minute Bid.' Use primary CTA 'Run My Growth Scan'. Explain recompete timing, incumbent context, vehicle/access requirements, agency alignment, and prime-versus-team strategy. Include the recommendation labels PRIME, TEAM, POSITION EARLY, MONITOR, PASS. Do not present modeled recompetes as confirmed procurements and do not invent proof or metrics.",
  LEGACY_POSITIONING_CLEANUP: "Clean up legacy P2GC positioning for /business-plans. Remove it from main navigation and service menus. If B12 can safely hide/delete it, do so; otherwise set it to noindex if available. Do not add business-plan, grant, loan, business-credit, or generic website-service positioning. Preserve current GovCon pages."
};

class B12ControlledPublisherV7 extends V6Publisher {
  applyCompactPrompts() {
    if (!this.manifest || !Array.isArray(this.manifest.operations)) return;
    this.manifest = {
      ...this.manifest,
      operations: this.manifest.operations.map(op => compactPrompts[op.id] ? { ...op, prompt: compactPrompts[op.id], compactPrompt: true } : op)
    };
  }

  operationTimeoutMs(prompt) {
    if (/Create or update a page called/i.test(String(prompt || ''))) return 12 * 60 * 1000;
    if (/Clean up legacy P2GC positioning/i.test(String(prompt || ''))) return 8 * 60 * 1000;
    return 8 * 60 * 1000;
  }

  async waitForAgentSettled(timeoutMs = 12 * 60 * 1000) {
    const started = Date.now();
    let lastTail = '';
    let stable = 0;
    let lastHeartbeatBucket = -1;
    let lastChangeAt = started;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const tail = body.slice(-12000);
      const working = /thinking|working on it|making changes|generating|updating your site|writing code|applying changes/i.test(tail);

      if (tail !== lastTail) lastChangeAt = Date.now();
      if (!working && tail && tail === lastTail) stable += 1;
      else stable = 0;
      lastTail = tail;

      const elapsedMs = Date.now() - started;
      const noVisibleProgressMs = Date.now() - lastChangeAt;
      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS] elapsed=${Math.round(elapsedMs / 1000)}s working=${working} stable=${stable} lastChangeAgo=${Math.round(noVisibleProgressMs / 1000)}s`);
      }

      if (stable >= 2) {
        return { ok: true, status: 'AGENT_SETTLED_PHASED_PROMPT', elapsedMs, workingAtCompletion: false };
      }

      if (working && noVisibleProgressMs >= 6 * 60 * 1000) {
        return {
          ok: false,
          status: 'AGENT_STALLED_NO_VISIBLE_PROGRESS',
          stillWorking: true,
          elapsedMs,
          lastChangeAgoMs: noVisibleProgressMs,
          stallThresholdMs: 6 * 60 * 1000
        };
      }
    }

    return {
      ok: false,
      status: 'AGENT_MAX_WAIT_WITHOUT_SETTLED_COMPLETION',
      timeoutMs,
      elapsedMs: Date.now() - started,
      lastChangeAgoMs: Date.now() - lastChangeAt
    };
  }

  async run(options = {}) {
    this.applyCompactPrompts();
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V7_RESUMABLE_PHASED_PROMPTS';
      result.promptStrategy = 'COMPACT_B12_RECOMMENDED_PAGE_SCAFFOLD';
      try {
        const fs = require('fs');
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV7();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV7;
