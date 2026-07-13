const path = require('path');
const { MilesRuntime } = require('../src/main/runtime/milesRuntime');
const rt = new MilesRuntime(path.resolve(__dirname, '..'));
rt.start();
rt.tick(); rt.tick();
const s = rt.status();
function assert(x,msg){ if(!x){ console.error('FAIL:', msg); process.exit(1); } }
assert(s.running === true, 'runtime should run');
assert(Array.isArray(s.connectors) && s.connectors.length >= 7, 'connectors should exist');
assert(s.workers.length >= 5, 'workers should exist');
assert(s.tasks.completed >= 1, 'runtime should complete at least one task');
const brief = rt.command('Miles, what needs my attention?');
assert(brief.type === 'brief', 'executive brain should return attention brief');
console.log('MILES Desktop v2 Build 003 smoke test passed.');
process.exit(0);
