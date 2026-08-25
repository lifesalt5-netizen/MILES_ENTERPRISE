'use strict';

const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }

class B12ControlledPublisherV3 extends BasePublisher {
  editorScopes() {
    if (!this.page) return [];
    const frames = typeof this.page.frames === 'function' ? this.page.frames() : [];
    return frames.map((scope, index) => ({
      scope,
      index,
      url: typeof scope.url === 'function' ? scope.url() : ''
    }));
  }

  async scopeText(scope) {
    return scope.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  }

  async combinedEditorText() {
    const chunks = [];
    for (const item of this.editorScopes()) {
      const text = await this.scopeText(item.scope);
      if (text) chunks.push(text);
    }
    return chunks.join('\n');
  }

  async waitForEditorHydration(timeoutMs = 20000) {
    const started = Date.now();
    let lastFrameCount = 0;
    while (Date.now() - started < timeoutMs) {
      const scopes = this.editorScopes();
      lastFrameCount = scopes.length;
      for (const item of scopes) {
        const scope = item.scope;
        const body = await this.scopeText(scope);
        const interactiveCount = await scope.locator('textarea,[contenteditable="true"],[role="textbox"],button,a').count().catch(() => 0);
        if (clean(body) || interactiveCount > 0 || scopes.length > 1) {
          return { ok: true, frameCount: scopes.length };
        }
      }
      await sleep(500);
    }
    return { ok: false, frameCount: lastFrameCount };
  }

  async inventoryForScope(item) {
    const scope = item.scope;
    const body = await this.scopeText(scope);
    const buttons = await scope.getByRole('button').allInnerTexts().catch(() => []);
    const links = await scope.getByRole('link').allInnerTexts().catch(() => []);
    const placeholders = await scope.locator('textarea,input,[contenteditable="true"]').evaluateAll(nodes => nodes.map(n => ({
      tag: n.tagName,
      type: n.getAttribute('type'),
      placeholder: n.getAttribute('placeholder'),
      aria: n.getAttribute('aria-label'),
      role: n.getAttribute('role'),
      contenteditable: n.getAttribute('contenteditable')
    })).slice(0, 100)).catch(() => []);
    return {
      index: item.index,
      url: item.url,
      bodyPreview: body.slice(0, 3000),
      buttons: buttons.slice(0, 80),
      links: links.slice(0, 80),
      placeholders
    };
  }

  async uiInventory() {
    const hydration = await this.waitForEditorHydration();
    const frames = [];
    for (const item of this.editorScopes()) {
      frames.push(await this.inventoryForScope(item));
    }
    const body = frames.map(x => x.bodyPreview).filter(Boolean).join('\n');
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      bodyPreview: body.slice(0, 12000),
      buttons: frames.flatMap(x => x.buttons).slice(0, 160),
      links: frames.flatMap(x => x.links).slice(0, 160),
      placeholders: frames.flatMap(x => x.placeholders).slice(0, 200),
      hydration,
      frameCount: frames.length,
      frames
    };
  }

  async findVisibleInScope(scope, locator) {
    try {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const item = locator.nth(i);
        if (await item.isVisible({ timeout: 700 }).catch(() => false)) return item;
      }
    } catch {}
    return null;
  }

  async findAgentInput() {
    const strongSelectors = [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="agent" i]',
      'textarea[aria-label*="Ask" i]',
      'textarea[aria-label*="message" i]',
      '[contenteditable="true"][aria-label*="Ask" i]',
      '[contenteditable="true"][aria-label*="message" i]',
      '[role="textbox"][aria-label*="Ask" i]',
      '[role="textbox"][aria-label*="message" i]',
      'input[placeholder*="Ask" i]',
      'input[placeholder*="message" i]'
    ];

    const scopes = this.editorScopes();
    for (const item of scopes) {
      for (const selector of strongSelectors) {
        const locator = item.scope.locator(selector);
        const count = await locator.count().catch(() => 0);
        for (let i = count - 1; i >= 0; i -= 1) {
          const input = locator.nth(i);
          if (await input.isVisible().catch(() => false)) return { input, scope: item.scope, scopeUrl: item.url };
        }
      }
    }

    for (const item of scopes) {
      const body = await this.scopeText(item.scope);
      if (!/AI Agent|Visual Edit|Ask B12|Assistant/i.test(body)) continue;
      for (const selector of ['textarea', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', '[role="textbox"]']) {
        const locator = item.scope.locator(selector);
        const count = await locator.count().catch(() => 0);
        for (let i = count - 1; i >= 0; i -= 1) {
          const input = locator.nth(i);
          if (await input.isVisible().catch(() => false)) return { input, scope: item.scope, scopeUrl: item.url };
        }
      }
    }
    return null;
  }

  async findAgentTrigger() {
    for (const item of this.editorScopes()) {
      const scope = item.scope;
      const candidates = [
        scope.getByRole('button', { name: /AI Agent|Ask B12|AI Assistant|Assistant/i }),
        scope.getByText('AI Agent', { exact: true }),
        scope.getByText(/AI Agent|Ask B12/i)
      ];
      for (const candidate of candidates) {
        const trigger = await this.findVisibleInScope(scope, candidate);
        if (trigger) return { trigger, scope, scopeUrl: item.url };
      }
    }
    return null;
  }

  async openAgent() {
    await this.waitForEditorHydration();

    const alreadyOpen = await this.findAgentInput();
    if (alreadyOpen) return { ok: true, ...alreadyOpen, status: 'B12_AI_AGENT_INPUT_ALREADY_VISIBLE' };

    const found = await this.findAgentTrigger();
    if (!found) {
      const ui = await this.uiInventory();
      return { ok: false, status: 'B12_AI_AGENT_TRIGGER_NOT_FOUND_FRAME_AWARE', frameCount: ui.frameCount, frames: ui.frames };
    }

    await found.trigger.click();
    await sleep(900);
    const resolved = await this.findAgentInput();
    return resolved
      ? { ok: true, ...resolved, status: 'B12_AI_AGENT_OPENED' }
      : { ok: false, status: 'B12_AI_AGENT_INPUT_NOT_FOUND_FRAME_AWARE', triggerScopeUrl: found.scopeUrl };
  }

  async waitForAgentSettled(timeoutMs = 180000) {
    const started = Date.now();
    let last = '';
    let stable = 0;
    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const tail = body.slice(-10000);
      const working = /thinking|working on it|making changes|generating|updating your site|writing code|applying changes/i.test(tail);
      if (!working && tail && tail === last) stable += 1;
      else stable = 0;
      last = tail;
      if (stable >= 2) return { ok: true, status: 'AGENT_SETTLED_FRAME_AWARE' };
    }
    return { ok: false, status: 'AGENT_SETTLE_TIMEOUT_FRAME_AWARE' };
  }

  async findSubmitButton(scope, input) {
    const direct = [
      scope.locator('button[aria-label*="send" i]'),
      scope.locator('button[aria-label*="submit" i]'),
      scope.locator('button[data-testid*="send" i]'),
      scope.getByRole('button', { name: /send|submit|send message|up arrow/i })
    ];
    for (const locator of direct) {
      const found = await this.findVisibleInScope(scope, locator);
      if (found && await found.isEnabled().catch(() => true)) return found;
    }

    const form = input.locator('xpath=ancestor::form[1]');
    if (await form.count().catch(() => 0)) {
      const buttons = form.getByRole('button');
      const count = await buttons.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        const button = buttons.nth(i);
        if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => true)) return button;
      }
    }
    return null;
  }

  async sendAgentPrompt(prompt) {
    const opened = await this.openAgent();
    if (!opened.ok) return opened;
    const { input, scope } = opened;

    try {
      await input.fill(prompt);
    } catch {
      await input.click();
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
      await input.press('Backspace').catch(() => null);
      await input.type(prompt);
    }

    const send = await this.findSubmitButton(scope, input);
    if (send) await send.click();
    else await input.press('Enter');

    const settled = await this.waitForAgentSettled();
    return { ...settled, inputScopeUrl: opened.scopeUrl || '' };
  }

  async findEditorButton(nameRegex) {
    for (const item of this.editorScopes()) {
      const button = await this.findVisibleInScope(item.scope, item.scope.getByRole('button', { name: nameRegex }));
      if (button) return { button, scope: item.scope, scopeUrl: item.url };
    }
    return null;
  }

  async clickPreview() {
    const before = new Set(this.context.pages());
    const found = await this.findEditorButton(/^Preview$/i);
    if (!found) return { ok: false, status: 'PREVIEW_BUTTON_NOT_FOUND_FRAME_AWARE' };
    await found.button.click();
    await sleep(1800);

    const pages = this.context.pages();
    const newPage = pages.find(p => !before.has(p));
    if (!newPage) return { ok: false, status: 'PREVIEW_PAGE_NOT_OPENED', triggerScopeUrl: found.scopeUrl };

    await newPage.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => null);
    const url = newPage.url();
    if (!/^https?:/i.test(url)) return { ok: false, status: 'PREVIEW_URL_NOT_RESOLVED', url };
    return { ok: true, page: newPage, url };
  }

  async publish() {
    const found = await this.findEditorButton(/^Publish$/i);
    if (!found) return { ok: false, status: 'PUBLISH_BUTTON_NOT_FOUND_FRAME_AWARE', mutationExecuted: false };
    await found.button.click();
    await sleep(1500);
    const body = await this.combinedEditorText();
    const confirm = await this.findEditorButton(/publish|confirm|continue/i);
    if (/confirm|publish changes|make.*live/i.test(body.slice(-5000)) && confirm) {
      await confirm.button.click();
      await sleep(1500);
    }
    return { ok: true, status: 'PUBLISH_ACTION_SUBMITTED_FRAME_AWARE', mutationExecuted: true };
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV3();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV3;
