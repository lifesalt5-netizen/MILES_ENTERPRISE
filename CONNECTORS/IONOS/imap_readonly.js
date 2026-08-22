'use strict';

const tls = require('tls');
require('dotenv').config();

const HOST = process.env.IONOS_IMAP_HOST || 'imap.ionos.com';
const PORT = Number(process.env.IONOS_IMAP_PORT || 993);
const TIMEOUT_MS = Number(process.env.IONOS_IMAP_TIMEOUT_MS || 15000);

function quote(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mailboxConfigs() {
  return [
    { key: 'info', email: process.env.IONOS_INFO_EMAIL || 'info@pathways2gc.com', password: process.env.IONOS_INFO_PASSWORD || '' },
    { key: 'kevin', email: process.env.IONOS_KEVIN_EMAIL || 'kevin@pathways2gc.com', password: process.env.IONOS_KEVIN_PASSWORD || '' }
  ];
}

function connectAndRun({ email, password, commands = [] }) {
  return new Promise((resolve, reject) => {
    if (!email || !password) return reject(new Error(`Missing IONOS credentials for ${email || 'unknown mailbox'}`));

    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
    socket.setTimeout(TIMEOUT_MS);

    let buffer = '';
    let seq = 0;
    const pending = [];
    let completed = false;

    function cleanup(error, result) {
      if (completed) return;
      completed = true;
      try { socket.end(); } catch (_) {}
      if (error) reject(error); else resolve(result);
    }

    function send(command) {
      return new Promise((res, rej) => {
        const tag = `A${String(++seq).padStart(4, '0')}`;
        pending.push({ tag, res, rej, lines: [] });
        socket.write(`${tag} ${command}\r\n`);
      });
    }

    function processLines() {
      const parts = buffer.split(/\r\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        const current = pending[0];
        if (current) current.lines.push(line);
        if (current && line.startsWith(`${current.tag} `)) {
          pending.shift();
          if (/^A\d+ OK\b/i.test(line)) current.res(current.lines.slice());
          else current.rej(new Error(`IMAP command failed for ${email}: ${line}`));
        }
      }
    }

    socket.on('data', chunk => { buffer += chunk.toString('utf8'); processLines(); });
    socket.on('timeout', () => cleanup(new Error(`IONOS IMAP timeout for ${email}`)));
    socket.on('error', error => cleanup(error));

    socket.on('secureConnect', async () => {
      try {
        const loginLines = await send(`LOGIN ${quote(email)} ${quote(password)}`);
        const selectLines = await send('EXAMINE INBOX');
        const extra = [];
        for (const command of commands) extra.push({ command, lines: await send(command) });
        try { await send('LOGOUT'); } catch (_) {}
        cleanup(null, { ok: true, email, host: HOST, port: PORT, loginLines, selectLines, extra });
      } catch (error) {
        cleanup(error);
      }
    });
  });
}

async function healthCheck(mailbox) {
  const result = await connectAndRun(mailbox);
  const existsLine = (result.selectLines || []).find(line => /^\* \d+ EXISTS$/i.test(line));
  const exists = existsLine ? Number(existsLine.split(' ')[1]) : null;
  return { ok: true, email: mailbox.email, host: HOST, port: PORT, inboxExists: exists, readOnly: true };
}

async function healthCheckAll() {
  const results = [];
  for (const mailbox of mailboxConfigs()) {
    try {
      results.push(await healthCheck(mailbox));
    } catch (error) {
      results.push({ ok: false, email: mailbox.email, host: HOST, port: PORT, readOnly: true, error: error.message });
    }
  }
  return { ok: results.length > 0 && results.every(r => r.ok), mailboxes: results, readOnly: true };
}

module.exports = { HOST, PORT, mailboxConfigs, connectAndRun, healthCheck, healthCheckAll };
