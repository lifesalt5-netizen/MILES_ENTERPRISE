'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const RemoteExecutionBridgeSupervisor = require('../SERVICES/runtime/RemoteExecutionBridgeSupervisor');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-bridge-supervisor-'));
  fs.mkdirSync(path.join(root, 'DATA', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'StartMilesRemoteExecutionBridge.js'), "console.log('test bridge');\n", 'utf8');

  const children = [];
  const spawnFn = (command, args, options) => {
    assert.strictEqual(command, process.execPath);
    assert.deepStrictEqual(args, [path.join(root, 'StartMilesRemoteExecutionBridge.js')]);
    assert.strictEqual(options.shell, false);
    assert.strictEqual(options.env.MILES_BRIDGE_SUPERVISED, 'true');
    assert.strictEqual(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.strictEqual(options.env.GIT_CONFIG_COUNT, '2');
    assert.strictEqual(options.env.GIT_CONFIG_KEY_0, 'http.lowSpeedLimit');
    assert.strictEqual(options.env.GIT_CONFIG_VALUE_0, '1');
    assert.strictEqual(options.env.GIT_CONFIG_KEY_1, 'http.lowSpeedTime');
    assert.strictEqual(options.env.GIT_CONFIG_VALUE_1, '20');
    const child = new EventEmitter();
    child.pid = 41000 + children.length;
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null); return true; };
    children.push(child);
    setImmediate(() => child.emit('spawn'));
    return child;
  };

  const supervisor = new RemoteExecutionBridgeSupervisor({ root, spawnFn, restartDelayMs: 500 });
  const started = supervisor.start();
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.status, 'SUPERVISION_STARTED');
  await sleep(20);
  assert.strictEqual(children.length, 1);

  children[0].exitCode = 75;
  children[0].emit('exit', 75, null);
  await sleep(650);
  assert.strictEqual(children.length, 2, 'bridge must restart automatically after supervised code-update exit');
  assert.strictEqual(supervisor.restartCount, 1);

  const state = supervisor.status();
  assert.strictEqual(state.running, true);
  assert.strictEqual(state.status, 'BRIDGE_RUNNING');
  assert.strictEqual(state.restartCount, 1);
  assert.strictEqual(state.gitLowSpeedLimit, 1);
  assert.strictEqual(state.gitLowSpeedTime, 20);

  supervisor.stop();
  assert.strictEqual(fs.existsSync(supervisor.lockFile), false, 'supervisor lock must be released on shutdown');
  const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'runtime', 'RemoteExecutionBridgeSupervisor.js'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'StartMilesRemoteExecutionBridge.js'), 'utf8');
  assert(source.includes("MILES_BRIDGE_SUPERVISED: 'true'"));
  assert(source.includes("GIT_TERMINAL_PROMPT: '0'"));
  assert(source.includes("GIT_CONFIG_KEY_1: 'http.lowSpeedTime'"));
  assert(bridgeSource.includes('SUPERVISOR_RESTART_AFTER_CODE_UPDATE'));
  assert(bridgeSource.includes('process.exit(SUPERVISED_RESTART_EXIT_CODE)'));
  assert(!source.includes('shell: true'));
  assert(!source.includes('powershell'));
  assert(!source.includes('cmd.exe'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('REMOTE_EXECUTION_BRIDGE_SUPERVISOR=PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
