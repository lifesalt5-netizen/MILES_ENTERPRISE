'use strict';

const fs = require('fs');
const V9Publisher = require('./B12_CONTROLLED_PUBLISHER_V9');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const atomicPageNames = {
  GSA_ZERO_SALES_PAGE_SCAFFOLD: 'GSA Zero-Sales Diagnostic',
  FEDERAL_REVENUE_GAP_PAGE_SCAFFOLD: 'Federal Revenue Gap Analysis',
  RECOMPETE_VEHICLE_PAGE_SCAFFOLD: 'Recompete & Vehicle Growth Scan'
};

const navCleanupPrompts = {
  GSA_ZERO_SALES_PAGE: "Remove the 'GSA Zero-Sales Diagnostic' page from the main navigation. Keep the page itself and its content. Do not change any other page.",
  FEDERAL_REVENUE_GAP_PAGE: "Remove the 'Federal Revenue Gap Analysis' page from the main navigation. Keep the page itself and its content. Do not change any other page.",
  RECOMPETE_VEHICLE_PAGE: "Remove the 'Recompete & Vehicle Growth Scan' page from the main navigation. Keep the page itself and its content. Do not change any other page."
};

class B12ControlledPublisherV10 extends V9Publisher {
  applyCompactPrompts() {
    super.applyCompactPrompts();
    if (!this.manifest || !Array.isArray(this.manifest.operations)) return;

    const operations = [];
    for (const op of this.manifest.operations) {
      if (atomicPageNames[op.id]) {
        operations.push({
          ...op,
          type: 'AI_AGENT_ATOMIC_PAGE_CREATE',
          prompt: `Add a new page called '${atomicPageNames[op.id]}' to my site.`,
          atomicProviderPrompt: true
        });
        continue;
      }

      operations.push(op);
      if (navCleanupPrompts[op.id]) {
        operations.push({
          id: `${op.id}_NAV_CLEANUP`,
          type: 'AI_AGENT_ATOMIC_NAV_CLEANUP',
          target: op.target,
          required_markers: [],
          prompt: navCleanupPrompts[op.id],
          atomicProviderPrompt: true
        });
      }
    }

    this.manifest = { ...this.manifest, operations };
  }

  operationTimeoutMs(prompt) {
    const text = String(prompt || '');
    if (/^Add a new page called/i.test(text)) return 15 * 60 * 1000;
    if (/^Remove the .* page from the main navigation/i.test(text)) return 6 * 60 * 1000;
    if (/^On the existing .* page only/i.test(text)) return 10 * 60 * 1000;
    return super.operationTimeoutMs(prompt);
  }

  async waitForAgentSettled(timeoutMs = 15 * 60 * 1000) {
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
        return {
          ok: true,
          status: 'AGENT_SETTLED_ATOMIC_PROVIDER_PROMPT',
          elapsedMs,
          workingAtCompletion: false
        };
      }

      if (working && noVisibleProgressMs >= 10 * 60 * 1000) {
        return {
          ok: false,
          status: 'AGENT_STALLED_ATOMIC_PROVIDER_PROMPT',
          stillWorking: true,
          elapsedMs,
          lastChangeAgoMs: noVisibleProgressMs,
          stallThresholdMs: 10 * 60 * 1000,
          providerDiagnostics: {
            taskListMentioned: /task list/i.test(tail),
            aiFixMentioned: /ai fix|fix with ai/i.test(tail),
            tailPreview: tail.slice(-2500)
          }
        };
      }
    }

    return {
      ok: false,
      status: 'AGENT_ATOMIC_PROVIDER_MAX_WAIT',
      timeoutMs,
      elapsedMs: Date.now() - started,
      lastChangeAgoMs: Date.now() - lastChangeAt,
      providerDiagnostics: {
        taskListMentioned: /task list/i.test(lastTail),
        aiFixMentioned: /ai fix|fix with ai/i.test(lastTail),
        tailPreview: lastTail.slice(-2500)
      }
    };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V10_DURABLE_RESUME_ATOMIC_PAGE_CREATE';
      result.promptStrategy = 'OFFICIAL_STYLE_ATOMIC_PAGE_CREATE_THEN_CONTENT_THEN_NAV_CLEANUP';
      result.providerPolicy = {
        pageCreatePromptShape: "Add a new page called '[page name]' to my site.",
        pageCreateMaxWaitMs: 15 * 60 * 1000,
        noVisibleProgressFailMs: 10 * 60 * 1000
      };
      try {
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

if (require.main === module) {
  const publisher = new B12ControlledPublisherV10();
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

module.exports = B12ControlledPublisherV10;
