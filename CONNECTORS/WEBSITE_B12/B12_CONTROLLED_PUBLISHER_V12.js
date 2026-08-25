'use strict';

const fs = require('fs');
const V11Publisher = require('./B12_CONTROLLED_PUBLISHER_V11');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }

function recentLines(text, count = 40) {
  return String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(-count);
}

function hasProviderWorkingSignal(text) {
  return recentLines(text, 30).some(line =>
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

class B12ControlledPublisherV12 extends V11Publisher {
  pruneKnownFalseGreenLedger() {
    if (this.manifest?.site !== 'pathways2gc.com') return;
    const file = this.successLedgerFile();
    if (!fs.existsSync(file)) return;
    try {
      const ledger = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const invalidIfLegacy = [
        'GSA_ZERO_SALES_PAGE',
        'GSA_ZERO_SALES_PAGE_NAV_CLEANUP'
      ];
      let changed = false;
      for (const id of invalidIfLegacy) {
        const saved = ledger?.operations?.[id];
        if (saved && saved.priorStatus !== 'AGENT_OPERATION_FULLY_COMPLETED_V12') {
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

  loadResumeState() {
    this.pruneKnownFalseGreenLedger();
    return super.loadResumeState();
  }

  async clickExpectedProviderConfirmation() {
    const forbidden = /publish|delete site|remove site/i;
    const preferred = /^(?:remove .+ from navigation|hide .+ from navigation|confirm|apply|continue|yes|proceed)$/i;
    for (const item of this.editorScopes()) {
      const buttons = item.scope.getByRole('button');
      const count = await buttons.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const button = buttons.nth(i);
        if (!(await button.isVisible().catch(() => false))) continue;
        const label = clean(await button.innerText().catch(() => '') || await button.getAttribute('aria-label').catch(() => ''));
        if (!label || forbidden.test(label) || !preferred.test(label)) continue;
        await button.click();
        return { ok: true, label, scopeUrl: item.url };
      }
    }
    return { ok: false, status: 'EXPECTED_PROVIDER_CONFIRMATION_BUTTON_NOT_FOUND' };
  }

  async waitForAgentSettled(timeoutMs = 10 * 60 * 1000) {
    const started = Date.now();
    let lastTail = '';
    let stable = 0;
    let lastHeartbeatBucket = -1;
    let lastChangeAt = started;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const tail = body.slice(-12000);
      const recent = tail.slice(-4500);
      const working = hasProviderWorkingSignal(recent);
      const continuation = hasContinuationRequest(recent);
      const confirmation = hasConfirmationRequest(recent);
      const explicit = hasExplicitCompletion(recent);

      if (tail !== lastTail) lastChangeAt = Date.now();
      if (!working && tail && tail === lastTail) stable += 1;
      else stable = 0;
      lastTail = tail;

      const elapsedMs = Date.now() - started;
      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS_V12] elapsed=${Math.round(elapsedMs/1000)}s working=${working} continuation=${continuation} confirmation=${confirmation} explicit=${explicit} stable=${stable}`);
      }

      if (!working && confirmation) {
        return { ok: false, interactionRequired: true, status: 'AGENT_CONFIRMATION_REQUIRED', elapsedMs, evidence: recent.slice(-2200) };
      }
      if (!working && continuation) {
        return { ok: false, interactionRequired: true, status: 'AGENT_CONTINUATION_REQUIRED', elapsedMs, evidence: recent.slice(-2200) };
      }
      if (!working && explicit && stable >= 1) {
        return { ok: true, status: 'AGENT_EXPLICIT_PROVIDER_COMPLETION_V12', elapsedMs, completionEvidence: recent.slice(-2200) };
      }
      if (!working && stable >= 3) {
        return { ok: true, status: 'AGENT_SETTLED_CONTEXT_AWARE_V12', elapsedMs };
      }

      if (working && Date.now() - lastChangeAt >= 6 * 60 * 1000) {
        return {
          ok: false,
          status: 'AGENT_STALLED_CONTEXT_AWARE_V12',
          elapsedMs,
          lastChangeAgoMs: Date.now() - lastChangeAt,
          evidence: recent.slice(-2200)
        };
      }
    }

    return { ok: false, status: 'AGENT_CONTEXT_AWARE_MAX_WAIT_V12', timeoutMs, elapsedMs: Date.now() - started, evidence: lastTail.slice(-2200) };
  }

  async submitAgentText(text) {
    const opened = await this.openAgent();
    if (!opened.ok) return opened;
    const { input, scope } = opened;
    try {
      await input.fill(text);
    } catch {
      await input.click();
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
      await input.press('Backspace').catch(() => null);
      await input.type(text);
    }
    const send = await this.findSubmitButton(scope, input);
    if (send) await send.click();
    else await input.press('Enter');
    return { ok: true, scopeUrl: opened.scopeUrl || '' };
  }

  async sendAgentPrompt(prompt) {
    const timeoutMs = this.operationTimeoutMs(prompt);
    const interactions = [];
    let currentPrompt = prompt;

    for (let round = 0; round < 5; round += 1) {
      const submitted = await this.submitAgentText(currentPrompt);
      if (!submitted.ok) return submitted;
      console.log(`[B12_AGENT_OPERATION_STARTED_V12] round=${round + 1} timeoutMs=${timeoutMs}`);
      let settled = await this.waitForAgentSettled(timeoutMs);

      if (settled.status === 'AGENT_CONFIRMATION_REQUIRED') {
        const clicked = await this.clickExpectedProviderConfirmation();
        interactions.push({ type: 'CONFIRMATION', clicked });
        if (!clicked.ok) return { ...settled, confirmation: clicked, timeoutMs, interactions };
        await sleep(1200);
        settled = await this.waitForAgentSettled(Math.min(timeoutMs, 6 * 60 * 1000));
      }

      if (settled.status === 'AGENT_CONTINUATION_REQUIRED') {
        interactions.push({ type: 'CONTINUATION', evidence: settled.evidence || '' });
        currentPrompt = 'Yes. Complete every remaining item from my immediately previous request on this page. Do not change any other page. Do not publish the website. Do not ask again unless a destructive action is required.';
        continue;
      }

      if (settled.ok) {
        return {
          ...settled,
          ok: true,
          status: 'AGENT_OPERATION_FULLY_COMPLETED_V12',
          providerCompletionStatus: settled.status,
          providerInteractionCompleted: true,
          timeoutMs,
          interactions,
          inputScopeUrl: submitted.scopeUrl
        };
      }

      return { ...settled, timeoutMs, interactions, inputScopeUrl: submitted.scopeUrl };
    }

    return { ok: false, status: 'AGENT_CONTINUATION_LIMIT_REACHED_V12', timeoutMs, interactions };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V12_FULL_OUTCOME_CONTINUATION_CONFIRMATION_AWARE';
      result.promptStrategy = 'ATOMIC_PAGE_CREATE_WITH_AUTOMATIC_CONTINUATION_AND_SAFE_CONFIRMATION';
      result.completionPolicy = {
        contextAwareWorkingSignalsOnly: true,
        marketingCopyCannotTriggerWorkingState: true,
        continuationRequestsAreNotCompletion: true,
        safeConfirmationButtonsHandled: true,
        legacyFalseGreenLedgerEntriesPruned: true,
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
  const publisher = new B12ControlledPublisherV12();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  publisher.run({ apply, publish }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV12;
module.exports.helpers = { hasProviderWorkingSignal, hasContinuationRequest, hasConfirmationRequest, hasExplicitCompletion };
