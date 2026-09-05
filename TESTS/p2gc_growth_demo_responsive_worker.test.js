'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'StartP2GCGrowthBlueprintDemo.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'SERVICES', 'demo', 'P2GCGrowthModelWorker.js'), 'utf8');

assert(server.includes('const { Worker } = require("worker_threads")'), 'server must use worker_threads');
assert(server.includes('P2GCGrowthModelWorker.js'), 'server must delegate assessment model construction');
assert(server.includes('assessmentIsolation:"WORKER_THREAD"'), 'health must expose assessment isolation');
assert(server.includes('fs.promises.readFile(file)'), 'static files must avoid synchronous reads on the HTTP event loop');
assert(!server.includes('samFallback.build(term)'), 'HTTP server must not perform synchronous SAM fallback scans');
assert(!server.includes('historicalNameIndex.resolve(term)'), 'HTTP server must not perform synchronous historical identity scans');
assert(worker.includes('samFallback.build(term)'), 'worker must retain SAM fallback behavior');
assert(worker.includes('historicalNameIndex.resolve(term)'), 'worker must retain historical identity fallback behavior');
assert(worker.includes('canonicalTruth.hydrate'), 'worker must retain canonical truth hydration');
assert(worker.includes('commercialPreview.apply'), 'worker must retain commercial preview generation');
assert(worker.includes('P2GC_GROWTH_WORKER_MAX_CONCURRENCY || 2'), 'worker pool must default to bounded concurrency of two');
assert(worker.includes("fs.openSync(candidate, 'wx')"), 'worker must claim an atomic runtime slot before heavy model construction');
assert(worker.includes('await acquireGate()'), 'worker must acquire a slot before loading heavyweight model dependencies');
assert(worker.indexOf('await acquireGate()') < worker.indexOf("require('./ExecutiveGrowthBlueprintDemoService')"), 'heavy demo dependencies must load only after slot acquisition');
assert(worker.includes('gateStaleMs'), 'worker slot gate must have stale-lock recovery');
assert(worker.includes('releaseGate()'), 'worker must release its model slot after completion/failure');

console.log('P2GC_GROWTH_DEMO_RESPONSIVE_WORKER_GREEN');
