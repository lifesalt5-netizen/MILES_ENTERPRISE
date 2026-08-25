'use strict';

const fs = require('fs');
const V12Publisher = require('./B12_CONTROLLED_PUBLISHER_V12');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }

function recentLines(text, count = 50) {
  return String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(-count);
}

function hasProviderWorkingSignal(text) {
  return recentLines(text, 35).some(line =>
    /^(?:thinking(?:\.{3})?|working on it(?:\.{3})?|making changes(?:\.{3})?|updating your site(?:\.{3})?|writing code(?:\.{3})?|applying changes(?:\.{3})?|creating .{1,120} page(?:\.{3})?)$/i.test(line)
  );
}

function hasContinuationRequest(text) {
  return /would you like me to (?:proceed|continue|help you|add|configure|finish|complete)/i.test(String(text || ''));
}

function hasConfirmationRequest(text) {
  return /please click the button below/i.test(String(text || ''));
}

function hasExplicitCompletion(text) {
  return /\bI(?:'ve| have)? (?:created|updated|added|removed|completed|finished)\b|\b(?:page|changes?) (?:is|are) (?:ready|complete|completed|updated|created)\b/i.test(String(text || ''));
}

function currentInteractionDelta(body, baseline, prompt) {
  const text = String(body || '');
  const base = String(baseline || '');
  const markerPrompt = clean(prompt);

  // Best evidence: provider output after the exact current user prompt shown in chat.
  if (markerPrompt) {
    const at = text.lastIndexOf(markerPrompt);
    if (at >= 0) return text.slice(at + markerPrompt.length);
  }

  // Next best: content appended after the pre-submit editor snapshot.
  if (base && text.startsWith(base)) return text.slice(base.length);

  // B12 can re-render the chat tree. Anchor on a unique tail of the baseline when possible.
  const anchor = base.slice(-700);
  if (anchor) {
    const at = text.lastIndexOf(anchor);
    if (at >= 0) return text.slice(at + anchor.length);
  }

  // Fail-safe diagnostic window. This is intentionally much smaller than V12's broad tail.
  return text.slice(-2200);
}

class B12ControlledPublisherV13 extends V12Publisher {
  pruneKnownFalseGreenLedger() {
    if (this.manifest?.site !== 'pathways2gc.com') return;
    const file = this.successLedgerFile();
    if (!fs.existsSync(file)) return;
    try {
      const ledger = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const invalidIfLegacy = ['GSA_ZERO_SALES_PAGE', 'GSA_ZERO_SALES_PAGE_NAV_CLEANUP'];
      let changed = false;
      for (const id of invalidIfLegacy) {
        const saved = ledger?.operations?.[id];
        if (saved && !['AGENT_OPERATION_FULLY_COMPLETED_V12', 'AGENT_OPERATION_FULLY_COMPLETED_V13'].includes(saved.priorStatus)) {
          delete ledger.operations[id];
          changed = true;
        }
      }
      if (changed) {
        ledger.updatedAt = new Date().toISOString();
        fs.writeFileSync(file, JSON.stringify(ledger, null, 2), 'utf8');
      }
    } catch {}
  }

  async waitForCurrentInteractionSettled({ timeoutMs, baseline, prompt }) {
    const started = Date.now();
    let lastDelta = '';
    let stable = 0;
    let lastHeartbeatBucket = -1;
    let lastChangeAt = started;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const delta = currentInteractionDelta(body, baseline, prompt);
      const recent = delta.slice(-4500);
      const working = hasProviderWorkingSignal(recent);
      const continuation = hasContinuationRequest(recent);
      const confirmation = hasConfirmationRequest(recent);
      const explicit = hasExplicitCompletion(recent);

      if (delta !== lastDelta) lastChangeAt = Date.now();
      if (!working && delta && delta === lastDelta) stable += 1;
      else stable = 0;
      lastDelta = delta;

      const elapsedMs = Date.now() - started;
      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS_V13] elapsed=${Math.round(elapsedMs/1000)}s working=${working} continuation=${continuation} confirmation=${confirmation} explicit=${explicit} stable=${stable} deltaChars=${delta.length}`);
      }

      if (!working && confirmation) {
        return { ok: false, interactionRequired: true, status: 'AGENT_CONFIRMATION_REQUIRED_CURRENT_INTERACTION', elapsedMs, evidence: recent.slice(-2200) };
      }
      if (!working && continuation) {
        return { ok: false, interactionRequired: true, status: 'AGENT_CONTINUATION_REQUIRED_CURRENT_INTERACTION', elapsedMs, evidence: recent.slice(-2200) };
      }
      if (!working && explicit && stable >= 1) {
        return { ok: true, status: 'AGENT_EXPLICIT_PROVIDER_COMPLETION_CURRENT_INTERACTION', elapsedMs, completionEvidence: recent.slice(-2200) };
      }
      if (!working && delta && stable >= 3) {
        return { ok: true, status: 'AGENT_SETTLED_CURRENT_INTERACTION', elapsedMs, completionEvidence: recent.slice(-2200) };
      }
      if (working && Date.now() - lastChangeAt >= 6 * 60 * 1000) {
        return { ok: false, status: 'AGENT_STALLED_CURRENT_INTERACTION', elapsedMs, lastChangeAgoMs: Date.now() - lastChangeAt, evidence: recent.slice(-2200) };
      }
    }

    return { ok: false, status: 'AGENT_CURRENT_INTERACTION_MAX_WAIT', timeoutMs, elapsedMs: Date.now() - started, evidence: lastDelta.slice(-2200) };
  }

  async sendAgentPrompt(prompt) {
    const timeoutMs = this.operationTimeoutMs(prompt);
    const interactions = [];
    let currentPrompt = prompt;

    for (let round = 0; round < 6; round += 1) {
      const baseline = await this.combinedEditorText();
      const submitted = await this.submitAgentText(currentPrompt);
      if (!submitted.ok) return submitted;
      console.log(`[B12_AGENT_OPERATION_STARTED_V13] round=${round + 1} timeoutMs=${timeoutMs}`);

      let settled = await this.waitForCurrentInteractionSettled({ timeoutMs, baseline, prompt: currentPrompt });

      if (settled.status === 'AGENT_CONFIRMATION_REQUIRED_CURRENT_INTERACTION') {
        const preClick = await this.combinedEditorText();
        const clicked = await this.clickExpectedProviderConfirmation();
        interactions.push({ type: 'CONFIRMATION', clicked, evidence: settled.evidence || '' });
        if (!clicked.ok) return { ...settled, confirmation: clicked, timeoutMs, interactions };
        await sleep(1200);
        settled = await this.waitForCurrentInteractionSettled({
          timeoutMs: Math.min(timeoutMs, 6 * 60 * 1000),
          baseline: preClick,
          prompt: clicked.label || ''
        });
      }

      if (settled.status === 'AGENT_CONTINUATION_REQUIRED_CURRENT_INTERACTION') {
        interactions.push({ type: 'CONTINUATION', evidence: settled.evidence || '' });
        currentPrompt = 'Yes. Complete every remaining item from my immediately previous request on this page. Do not change any other page. Do not publish the website. Do not ask again unless a destructive action is required.';
        continue;
      }

      if (settled.ok) {
        return {
          ...settled,
          ok: true,
          status: 'AGENT_OPERATION_FULLY_COMPLETED_V13',
          providerCompletionStatus: settled.status,
          providerInteractionCompleted: true,
          currentInteractionScoped: true,
          timeoutMs,
          interactions,
          inputScopeUrl: submitted.scopeUrl
        };
      }

      return { ...settled, currentInteractionScoped: true, timeoutMs, interactions, inputScopeUrl: submitted.scopeUrl };
    }

    return { ok: false, status: 'AGENT_CONTINUATION_LIMIT_REACHED_V13', timeoutMs, interactions };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V13_CURRENT_INTERACTION_OUTCOME_AWARE';
      result.promptStrategy = 'CURRENT_INTERACTION_DELTA_WITH_AUTOMATIC_CONTINUATION_AND_SAFE_CONFIRMATION';
      result.completionPolicy = {
        currentInteractionScoped: true,
        historicalChatCannotTriggerContinuationOrConfirmation: true,
        contextAwareWorkingSignalsOnly: true,
        continuationRequestsAreNotCompletion: true,
        safeConfirmationButtonsHandled: true,
        publicPublishStillGated: true
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
  const publisher = new B12ControlledPublisherV13();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  publisher.run({ apply, publish }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV13;
module.exports.helpersV13 = { currentInteractionDelta, hasProviderWorkingSignal, hasContinuationRequest, hasConfirmationRequest, hasExplicitCompletion };
