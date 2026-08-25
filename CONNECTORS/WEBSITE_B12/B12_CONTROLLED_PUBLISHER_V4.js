'use strict';

const V3Publisher = require('./B12_CONTROLLED_PUBLISHER_V3');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function exactNavText(text) {
  return new RegExp(`^\\s*${text}\\s*$`, 'i');
}

class B12ControlledPublisherV4 extends V3Publisher {
  async findAgentInput() {
    const existing = await super.findAgentInput();
    if (existing) return existing;

    for (const item of this.editorScopes()) {
      const body = await this.scopeText(item.scope);
      if (!/(^|\n)\s*(Agent|Chat)\s*(\n|$)/im.test(body)) continue;

      const selectors = [
        'textarea',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]',
        '[role="textbox"]'
      ];

      for (const selector of selectors) {
        const locator = item.scope.locator(selector);
        const count = await locator.count().catch(() => 0);
        for (let i = count - 1; i >= 0; i -= 1) {
          const input = locator.nth(i);
          if (await input.isVisible().catch(() => false)) {
            return { input, scope: item.scope, scopeUrl: item.url };
          }
        }
      }
    }
    return null;
  }

  async findAgentTrigger() {
    const existing = await super.findAgentTrigger();
    if (existing) return existing;

    for (const item of this.editorScopes()) {
      const scope = item.scope;
      const candidates = [
        scope.getByRole('button', { name: exactNavText('Chat') }),
        scope.getByRole('link', { name: exactNavText('Chat') }),
        scope.getByText('Chat', { exact: true }),
        scope.getByRole('button', { name: exactNavText('Agent') }),
        scope.getByRole('link', { name: exactNavText('Agent') }),
        scope.getByText('Agent', { exact: true })
      ];

      for (const candidate of candidates) {
        const trigger = await this.findVisibleInScope(scope, candidate);
        if (trigger) {
          return { trigger, scope, scopeUrl: item.url };
        }
      }
    }
    return null;
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV4();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV4;
