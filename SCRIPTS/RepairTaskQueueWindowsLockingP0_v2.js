'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'CORE', 'TaskQueue.js');

if (!fs.existsSync(file)) {
  throw new Error('TaskQueue.js not found: ' + file);
}

let text = fs.readFileSync(file, 'utf8');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backup = file + '.BEFORE_WINDOWS_QUEUE_LOCK_FIX_' + stamp;
fs.copyFileSync(file, backup);

let changed = 0;

// 1) Extend default lock timeout from 10s to 60s.
const timeoutOld = 'Number(process.env.MILES_QUEUE_LOCK_TIMEOUT_MS || 10000)';
const timeoutNew = 'Number(process.env.MILES_QUEUE_LOCK_TIMEOUT_MS || 60000)';
if (text.includes(timeoutOld)) {
  text = text.replace(timeoutOld, timeoutNew);
  changed++;
}

// 2) Improve lock-acquisition failure diagnostics without changing semantics.
const withLockOld = 'throw new Error("TaskQueue lock could not be acquired.");';
const withLockNew = [
  'const owner = this.readLockOwner();',
  '            const ageMs = this.lockAgeMs();',
  '            throw new Error(',
  '                "TaskQueue lock could not be acquired after timeout. " +',
  '                "lockPath=" + this.lockPath +',
  '                "; ageMs=" + String(ageMs) +',
  '                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")',
  '            );'
].join('\n');
if (text.includes(withLockOld)) {
  text = text.replace(withLockOld, withLockNew);
  changed++;
}

// 3) Replace the Windows-hostile live-queue rotation section by method-local markers.
const startMarker = '            if (fs.existsSync(this.queuePath)) {';
const endMarker = '            fs.renameSync(tmp, this.queuePath);';
const searchFrom = text.indexOf('    writeJsonDirect(tasks) {');
if (searchFrom < 0) {
  throw new Error('writeJsonDirect(tasks) not found.');
}
const start = text.indexOf(startMarker, searchFrom);
const end = text.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  throw new Error('Queue rotation markers not found in local TaskQueue.js.');
}

const replacement = [
  '            /*',
  '             * BUILD P0 WINDOWS-SAFE QUEUE COMMIT',
  '             *',
  '             * Preserve a last-good snapshot, but never delete/rename the',
  '             * live queue as part of the fallback path. On Windows another',
  '             * process may briefly hold the live file open, causing EPERM.',
  '             */',
  '            if (fs.existsSync(this.queuePath)) {',
  '                try {',
  '                    fs.copyFileSync(this.queuePath, this.lastGoodPath);',
  '                } catch (backupError) {',
  '                    console.error(',
  '                        "[TaskQueue] Last-good snapshot refresh failed:",',
  '                        backupError.message',
  '                    );',
  '                }',
  '            }',
  '',
  '            try {',
  '                fs.renameSync(tmp, this.queuePath);',
  '            } catch (renameError) {',
  '                if (["EPERM", "EACCES", "EBUSY"].includes(renameError.code)) {',
  '                    console.error(',
  '                        `[TaskQueue] Atomic rename failed (${renameError.code}). Falling back to in-place copy: ${this.queuePath}`',
  '                    );',
  '                    fs.copyFileSync(tmp, this.queuePath);',
  '                } else {',
  '                    throw renameError;',
  '                }',
  '            }'
].join('\n');

text = text.slice(0, start) + replacement + text.slice(end + endMarker.length);
changed++;

fs.writeFileSync(file, text, 'utf8');

console.log('=== TASKQUEUE WINDOWS LOCKING REPAIR P0 V2 ===');
console.log('patched:', file);
console.log('backup :', backup);
console.log('changes:', changed);
console.log('next   : node --check .\\CORE\\TaskQueue.js');
