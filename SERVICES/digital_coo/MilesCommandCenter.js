'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const DigitalCOOHost = require('./DigitalCOOHost');
const CommandIntentPlannerService = require('../CommandIntentPlannerService');
const ExecutiveResponseService = require('../ExecutiveResponseService');
const ExecutiveConversationService = require('../ExecutiveConversationService');
const CEOIntentEngineService = require('../CEOIntentEngineService');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.MILES_COMMAND_PORT || 8787);

const stateDir = path.join(ROOT, 'state');
const logsDir = path.join(ROOT, 'logs');
const queueFile = path.join(stateDir, 'business_operations_queue.json');
const logFile = path.join(logsDir, 'miles_command_center.log');

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function log(level, message, metadata = {}) {
  fs.appendFileSync(
    logFile,
    JSON.stringify({
      timestamp: now(),
      level,
      service: 'MILES_COMMAND_CENTER',
      message,
      metadata
    }) + '\n'
  );
}

function classifyWorker(text, plan = {}) {
  const provider = String(plan.provider || '').toUpperCase();
  const action = String(plan.action || '').toUpperCase();
  const t = String(text || '').toLowerCase();

  if (provider === 'INSTANTLY') {
    return 'revenueWorker';
  }

  if (provider === 'ORION') {
    return 'atlasWorker';
  }

  if (provider === 'GOOGLE') {
    return 'cooWorker';
  }

  if (provider === 'WEBSITE') {
    return 'cooWorker';
  }

  if (provider === 'LINKEDIN') {
    return 'cooWorker';
  }

  if (action.startsWith('INSTANTLY_')) {
    return 'revenueWorker';
  }

  if (action.startsWith('ORION_')) {
    return 'atlasWorker';
  }

  if (action.startsWith('GOOGLE_')) {
    return 'cooWorker';
  }

  if (action.startsWith('WEBSITE_')) {
    return 'cooWorker';
  }

  if (action.startsWith('LINKEDIN_')) {
    return 'cooWorker';
  }

  if (
    t.includes('instantly') ||
    t.includes('campaign') ||
    t.includes('email') ||
    t.includes('lead')
  ) {
    return 'revenueWorker';
  }

  if (
    t.includes('reply') ||
    t.includes('respond') ||
    t.includes('inbox')
  ) {
    return 'replyWorker';
  }

  if (
    t.includes('deal') ||
    t.includes('proposal') ||
    t.includes('close')
  ) {
    return 'dealWorker';
  }

  if (
    t.includes('orion') ||
    t.includes('opportunit') ||
    t.includes('sled') ||
    t.includes('contract')
  ) {
    return 'atlasWorker';
  }

  if (
    t.includes('website') ||
    t.includes('linkedin') ||
    t.includes('marketing')
  ) {
    return 'cooWorker';
  }

  if (
    t.includes('run') ||
    t.includes('start') ||
    t.includes('check') ||
    t.includes('status')
  ) {
    return 'dispatcherWorker';
  }

  return 'cooWorker';
}

function needsApproval(text, plan = {}) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const action = String(plan.action || '').toUpperCase();

  // Approval is for an actual protected action, not for merely mentioning a
  // protected topic while defining governance, policy, data semantics, or
  // escalation boundaries. Bare words such as "contract", "legal", "sign",
  // and "financial commitment" are intentionally not sufficient by themselves.
  const protectedActions = new Set([
    'CHANGE_PRICING',
    'PRICING_CHANGE',
    'SEND_PROPOSAL',
    'SUBMIT_PROPOSAL',
    'SIGN_AGREEMENT',
    'SIGN_CONTRACT',
    'HIRE',
    'FIRE',
    'DELETE_PRODUCTION_DATA',
    'MAKE_FINANCIAL_COMMITMENT'
  ]);

  if (protectedActions.has(action)) {
    return true;
  }

  const protectedActionPatterns = [
    /\b(change|set|increase|decrease|discount|override)\s+(our\s+)?pricing\b/,
    /\b(send|submit|deliver)\s+(the\s+|a\s+)?(final\s+)?proposal\b/,
    /\b(sign|execute)\s+(the\s+|a\s+|an\s+)?(agreement|contract|legal document)\b/,
    /\b(hire|fire|terminate)\s+(an?\s+|the\s+)?(employee|contractor|staff|person|worker)\b/,
    /\b(delete|drop|destroy|purge)\s+(production\s+)?(database|records?|data|campaign|account|repository|repo)\b/,
    /\b(make|approve|authorize|commit|spend|purchase|pay)\b.{0,60}\b(financial commitment|payment|expense|purchase|spend|budget)\b/
  ];

  return protectedActionPatterns.some((pattern) => pattern.test(t));
}

function normalizeProvider(provider) {
  const value = String(provider || 'MILES').trim();

  if (value.toLowerCase() === 'website') {
    return 'Website';
  }

  if (value.toLowerCase() === 'linkedin') {
    return 'LinkedIn';
  }

  return value.toUpperCase();
}

function makeOperation(command, plan = {}) {
  const normalizedPlan = plan && plan.ok
    ? plan
    : CommandIntentPlannerService.plan({ command });

  const provider = normalizeProvider(
    normalizedPlan.provider || 'MILES'
  );

  const action = normalizedPlan.action || 'MILES_EXECUTE';

  const worker = classifyWorker(command, {
    ...normalizedPlan,
    provider,
    action
  });

  const approvalRequired = needsApproval(command, normalizedPlan);

  return {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'MILES_COMMAND_CENTER',
    type: approvalRequired
      ? 'CEO_APPROVAL_OPERATION'
      : action,
    status: approvalRequired
      ? 'AWAITING_APPROVAL'
      : 'READY',
    priority: 1,
    worker,
    area: worker.replace('Worker', ''),
    provider,
    system: normalizedPlan.system || provider,
    connector: normalizedPlan.connector || provider,
    department: normalizedPlan.department || provider,
    title: String(command || '').slice(0, 120),
    command,
    action,
    intent: normalizedPlan.intent,
    objective: normalizedPlan.objective || command,
    plan: {
      ...normalizedPlan,
      provider,
      system: normalizedPlan.system || provider,
      connector: normalizedPlan.connector || provider,
      department: normalizedPlan.department || provider,
      action
    },
    approvalRequired,
    ceoEscalationOnly: approvalRequired,
    createdAt: now(),
    updatedAt: now(),
    result: null
  };
}

function addToQueue(operation) {
  const queue = readJson(queueFile, {
    generatedAt: now(),
    source: 'MILES_COMMAND_CENTER',
    operations: []
  });

  queue.operations = Array.isArray(queue.operations)
    ? queue.operations
    : [];

  queue.operations.unshift(operation);
  queue.generatedAt = now();

  writeJson(queueFile, queue);
}

const host = new DigitalCOOHost({
  rootDir: ROOT
});

const executiveResponses = new ExecutiveResponseService({
  rootDir: ROOT
});

async function handleCommand(command) {
  const cleanCommand = String(command || '').trim();

  if (!cleanCommand) {
    return {
      ok: false,
      status: 'EMPTY_COMMAND',
      message: 'No command was provided.'
    };
  }

  const plan = CommandIntentPlannerService.plan({
    command: cleanCommand
  });

  const intent = String(plan.intent || '').toUpperCase();

  console.log('========================================');
  console.log('[COMMAND CENTER]');
  console.log('Command :', cleanCommand);
  console.log('Intent  :', intent);
  console.log('Workflow:', plan.workflow);
  console.log('Action  :', plan.action);
  console.log('========================================');

  if (
    intent === 'QUESTION' ||
    intent === 'CONVERSATION'
  ) {
    const response = await executiveResponses.respond({
      command: cleanCommand,
      plan
    });

    return {
      ok: true,
      status: 'CONVERSATION',
      conversation: true,
      message: response.message,
      response
    };
  }

  if (intent === 'AUDIT') {
    const response = await executiveResponses.audit({
      command: cleanCommand,
      plan
    });

    return {
      ok: true,
      status: 'AUDIT_COMPLETE',
      audit: true,
      message: response.message,
      response
    };
  }

  const operation = makeOperation(cleanCommand, plan);

  addToQueue(operation);

  let enqueueResult = null;

  if (
    host &&
    typeof host.enqueueOperation === 'function'
  ) {
    enqueueResult = await host.enqueueOperation(operation);
  }

  log('INFO', `Command accepted: ${cleanCommand}`, {
    operationId: operation.id,
    provider: operation.provider,
    action: operation.action,
    worker: operation.worker,
    approvalRequired: operation.approvalRequired
  });

  return {
    ok: true,
    status: 'COMMAND_ACCEPTED',
    message: operation.approvalRequired
      ? 'Miles created a CEO approval item.'
      : 'Miles accepted the work, planned the intent, and added it to the operations queue.',
    operation,
    enqueueResult
  };
}

function page() {
  const file = path.join(
    __dirname,
    'public',
    'index.html'
  );

  return fs.readFileSync(file, 'utf8');
}

function sendStaticFile(res, file, contentType) {
  try {
    const contents = fs.readFileSync(file);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });

    res.end(contents);
  } catch (error) {
    log('ERROR', 'Static asset serving failed', {
      file,
      error: error.message
    });

    res.writeHead(500, {
      'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Unable to load static asset.');
  }
}

async function start() {
  const hostStart = await host.start();

  if (!hostStart || hostStart.ok === false) {
    throw new Error(
      `Digital COO host failed to start: ${
        (hostStart && (hostStart.error || hostStart.status)) ||
        'unknown error'
      }`
    );
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/health') {
      try {
        const health = await host.healthCheck();
        res.writeHead(health.ok ? 200 : 503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(health, null, 2));
      } catch (error) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({ ok: false, status: 'HEALTH_FAILED', error: error.message }, null, 2));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/') {
      try {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });

        res.end(page());
      } catch (error) {
        log('ERROR', 'Command Center page failed', {
          error: error.message
        });

        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('Unable to load Miles Command Center.');
      }

      return;
    }

    if (
      req.method === 'GET' &&
      req.url === '/app.js'
    ) {
      const file = path.join(
        __dirname,
        'public',
        'app.js'
      );

      sendStaticFile(
        res,
        file,
        'application/javascript; charset=utf-8'
      );

      return;
    }

    if (
      req.method === 'GET' &&
      req.url === '/styles.css'
    ) {
      const file = path.join(
        __dirname,
        'public',
        'styles.css'
      );

      sendStaticFile(
        res,
        file,
        'text/css; charset=utf-8'
      );

      return;
    }

    if (
      req.method === 'GET' &&
      req.url === '/favicon.ico'
    ) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      req.method === 'GET' &&
      req.url.startsWith('/api/operation')
    ) {
      try {
        const url = new URL(
          req.url,
          `http://localhost:${PORT}`
        );

        const id = url.searchParams.get('id');

        const result = executiveResponses.getResponse(id);

        res.writeHead(200, {
          'Content-Type': 'application/json'
        });

        res.end(JSON.stringify(result, null, 2));
      } catch (error) {
        log('ERROR', 'Operation response failed', {
          error: error.message
        });

        res.writeHead(500, {
          'Content-Type': 'application/json'
        });

        res.end(
          JSON.stringify(
            {
              ok: false,
              error: error.message
            },
            null,
            2
          )
        );
      }

      return;
    }

    if (
      req.method === 'POST' &&
      req.url.startsWith('/api/operations/')
    ) {
      try {
        const url = new URL(
          req.url,
          `http://localhost:${PORT}`
        );

        const segments = url.pathname
          .split('/')
          .filter(Boolean);

        const operationId = segments[2];
        const action = segments[3];

        if (
          !operationId ||
          !['approve', 'reject'].includes(action || '')
        ) {
          res.writeHead(400, {
            'Content-Type': 'application/json'
          });

          res.end(
            JSON.stringify(
              {
                ok: false,
                error: 'Invalid operation action'
              },
              null,
              2
            )
          );

          return;
        }

        let body = '';

        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');

            const result = action === 'approve'
              ? await executiveResponses.approveOperation(
                operationId,
                payload.reason || ''
              )
              : await executiveResponses.rejectOperation(
                operationId,
                payload.reason || ''
              );

            res.writeHead(200, {
              'Content-Type': 'application/json'
            });

            res.end(JSON.stringify(result, null, 2));
          } catch (error) {
            log('ERROR', 'Operation approval failed', {
              error: error.message,
              operationId,
              action
            });

            res.writeHead(500, {
              'Content-Type': 'application/json'
            });

            res.end(
              JSON.stringify(
                {
                  ok: false,
                  error: error.message
                },
                null,
                2
              )
            );
          }
        });
      } catch (error) {
        log('ERROR', 'Operation approval route failed', {
          error: error.message
        });

        res.writeHead(500, {
          'Content-Type': 'application/json'
        });

        res.end(
          JSON.stringify(
            {
              ok: false,
              error: error.message
            },
            null,
            2
          )
        );
      }

      return;
    }

    if (
      req.method === 'POST' &&
      req.url === '/api/command'
    ) {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');

          const result = await handleCommand(
            String(payload.command || '').trim()
          );

          res.writeHead(200, {
            'Content-Type': 'application/json'
          });

          res.end(JSON.stringify(result, null, 2));
        } catch (error) {
          log('ERROR', 'Command handling failed', {
            error: error.message
          });

          res.writeHead(500, {
            'Content-Type': 'application/json'
          });

          res.end(
            JSON.stringify(
              {
                ok: false,
                error: error.message
              },
              null,
              2
            )
          );
        }
      });

      return;
    }

    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(
      `Miles Command Center running: http://localhost:${PORT}`
    );

    console.log('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', async () => {
    console.log('\nStopping Miles...');
    await host.stop();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});