'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'CORE', 'TaskQueue.js');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);

function show(pattern, before = 20, after = 80) {
  const idx = lines.findIndex((line) => line.includes(pattern));
  console.log(`\n=== ${pattern} ===`);
  if (idx < 0) {
    console.log('NOT FOUND');
    return;
  }
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length, idx + after + 1);
  for (let i = start; i < end; i += 1) {
    console.log(`${String(i + 1).padStart(5)}: ${lines[i]}`);
  }
}

console.log('=== LOCAL TASKQUEUE SHAPE P0 ===');
console.log(`file=${file}`);
console.log(`bytes=${Buffer.byteLength(text, 'utf8')}`);
show('acquireLock()', 20, 100);
show('writeJsonDirect(tasks)', 20, 180);
show('withLock(fn)', 20, 50);
