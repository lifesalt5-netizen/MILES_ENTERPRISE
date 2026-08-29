'use strict';

const http = require('http');
const { execFileSync } = require('child_process');

function getJson(port, path) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path, timeout: 8000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, text: json ? undefined : text.slice(0, 4000) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

function pm2Apps() {
  try {
    const shell = process.env.ComSpec || 'cmd.exe';
    const raw = execFileSync(shell, ['/d', '/s', '/c', 'pm2 jlist'], { encoding: 'utf8', windowsHide: true });
    const list = JSON.parse(raw);
    return list.map(item => {
      const env = item.pm2_env || {};
      return {
        name: item.name || env.name || null,
        pid: item.pid || null,
        status: env.status || null,
        pmExecPath: env.pm_exec_path || null,
        pmCwd: env.pm_cwd || null,
        args: env.args || [],
        nodeArgs: env.node_args || [],
        ports: {
          MILES_DASHBOARD_PORT: env.MILES_DASHBOARD_PORT || null,
          PORT: env.PORT || null,
          MILES_PORT: env.MILES_PORT || null,
          MILES_UNIFIED_PORT: env.MILES_UNIFIED_PORT || null,
          MILES_COMMAND_PORT: env.MILES_COMMAND_PORT || null
        }
      };
    });
  } catch (error) {
    return [{ error: error.message }];
  }
}

async function main() {
  const state = await getJson(8737, '/api/state');
  const brief = await getJson(8737, '/api/brief');
  const root = await getJson(8737, '/');
  const apps = pm2Apps();
  const likely = apps.filter(app => {
    const haystack = JSON.stringify(app).toLowerCase();
    return haystack.includes('8737') || haystack.includes('dashboard') || haystack.includes('executive');
  });

  const out = {
    ok: state.ok && brief.ok,
    service: 'MILES_CEO_DASHBOARD_BACKEND_TRACE',
    observedAt: new Date().toISOString(),
    port: 8737,
    state: {
      ok: state.ok,
      statusCode: state.statusCode,
      workQueue: state.json?.workQueue || null,
      topLevelKeys: state.json ? Object.keys(state.json) : []
    },
    brief: {
      ok: brief.ok,
      statusCode: brief.statusCode,
      requiresKevin: brief.json?.requiresKevin,
      approvalCount: brief.json?.approvalCount,
      topLevelKeys: brief.json ? Object.keys(brief.json) : []
    },
    root: { ok: root.ok, statusCode: root.statusCode },
    likelyPm2Apps: likely,
    allPm2Apps: apps,
    safety: { readOnly: true, processMutation: false, fileMutation: false, providerMutation: false }
  };

  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.stack || error.message }, null, 2));
  process.exitCode = 2;
});

module.exports = { main, pm2Apps, getJson };
