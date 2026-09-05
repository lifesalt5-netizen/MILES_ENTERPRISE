'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'StartP2GCGrowthBlueprintDemo.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'SERVICES', 'demo', 'P2GCGrowthModelWorker.js'), 'utf8');
const child = fs.readFileSync(path.join(root, 'SERVICES', 'demo', 'P2GCGrowthModelChild.js'), 'utf8');

assert(server.includes('const { Worker } = require("worker_threads")'), 'server must use worker_threads');
assert(server.includes('P2GCGrowthModelWorker.js'), 'server must delegate assessment model construction');
assert(server.includes('assessmentIsolation:"WORKER_THREAD"'), 'health must expose assessment isolation');
assert(server.includes('fs.promises.readFile(file)'), 'static files must avoid synchronous reads on the HTTP event loop');
assert(!server.includes('samFallback.build(term)'), 'HTTP server must not perform synchronous SAM fallback scans');
assert(!server.includes('historicalNameIndex.resolve(term)'), 'HTTP server must not perform synchronous historical identity scans');
assert(worker.includes("const { fork } = require('child_process')"), 'worker wrapper must isolate heavyweight model construction in a child process');
assert(worker.includes('P2GCGrowthModelChild.js'), 'worker wrapper must launch the dedicated child model builder');
assert(worker.includes('P2GC_GROWTH_WORKER_MAX_CONCURRENCY || 1'), 'worker pool must default to one heavyweight child at a time');
assert(worker.includes('--max-old-space-size=${childHeapMb}'), 'child process must have an explicit isolated heap ceiling');
assert(worker.includes("fs.openSync(candidate, 'wx')"), 'worker wrapper must claim an atomic runtime slot before child construction');
assert(worker.includes('await acquireGate()'), 'worker wrapper must acquire a slot before launching a heavyweight child');
assert(worker.includes('releaseGate()'), 'worker wrapper must release its model slot after completion/failure');
assert(!worker.includes("require('./ExecutiveGrowthBlueprintDemoService')"), 'worker wrapper must not load heavyweight demo dependencies');
assert(child.includes('samFallback.build(term)'), 'child must retain SAM fallback behavior');
assert(child.includes('historicalNameIndex.resolve(term)'), 'child must retain historical identity fallback behavior');
assert(child.includes('canonicalTruth.hydrate'), 'child must retain canonical truth hydration');
assert(child.includes('commercialPreview.apply'), 'child must retain commercial preview generation');

console.log('P2GC_GROWTH_DEMO_RESPONSIVE_WORKER_GREEN');
