'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const target = path.join(ROOT, 'CORE', 'TaskQueue.js');

if (!fs.existsSync(target)) {
  throw new Error('TaskQueue.js not found: ' + target);
}

let text = fs.readFileSync(target, 'utf8');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backup = target + '.BEFORE_WINDOWS_QUEUE_LOCK_REPAIR_' + stamp;
fs.copyFileSync(target, backup);

// 1) Increase default inter-process lock wait. The production queue can be large,
// and a legitimate writer may hold the lock for more than 10 seconds on Windows.
text = text.replace(
  'Number(process.env.MILES_QUEUE_LOCK_TIMEOUT_MS || 10000)',
  'Number(process.env.MILES_QUEUE_LOCK_TIMEOUT_MS || 60000)'
);

// 2) Replace the Windows-hostile queue rotation. The old fallback removed
// task_queue.json after rename failed, which produces EPERM when another process
// has a read handle open. Keep the canonical file in place and overwrite it from
// the fully written temp file while the TaskQueue lock is held.
const oldBlock = `            if (fs.existsSync(this.queuePath)) {
                fs.rmSync(
                    this.lastGoodPath,
                    { force: true }
                );

                try {
                    fs.renameSync(
                        this.queuePath,
                        this.lastGoodPath
                    );
                } catch {
                    fs.copyFileSync(
                        this.queuePath,
                        this.lastGoodPath
                    );
                    fs.rmSync(
                        this.queuePath,
                        { force: true }
                    );
                }
            }

            fs.renameSync(tmp, this.queuePath);`;

const newBlock = `            if (fs.existsSync(this.queuePath)) {
                /*
                 * Windows-safe snapshot: never delete or rename the live queue.
                 * Other MILES processes can legitimately have read handles open,
                 * and rm/rename of the live file can fail with EPERM.
                 */
                fs.copyFileSync(
                    this.queuePath,
                    this.lastGoodPath
                );
            }

            try {
                fs.renameSync(tmp, this.queuePath);
            } catch (error) {
                if (
                    error &&
                    ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
                ) {
                    /*
                     * Safe Windows fallback. The temp file has already been
                     * completely written and fsynced. Copy it over the canonical
                     * queue while the inter-process TaskQueue lock is still held.
                     */
                    fs.copyFileSync(tmp, this.queuePath);
                } else {
                    throw error;
                }
            }`;

if (!text.includes(oldBlock)) {
  throw new Error('Expected Windows-hostile queue rotation block not found. Local TaskQueue.js differs from inspected source.');
}
text = text.replace(oldBlock, newBlock);

// 3) Make lock acquisition diagnostics useful instead of a generic boot failure.
text = text.replace(
  'throw new Error("TaskQueue lock could not be acquired.");',
  'throw new Error(`TaskQueue lock could not be acquired within configured timeout. lockPath=${this.lockPath} owner=${JSON.stringify(this.readLockOwner())}`);'
);

fs.writeFileSync(target, text, 'utf8');

console.log('=== TASKQUEUE WINDOWS LOCKING REPAIR P0 ===');
console.log('patched:', target);
console.log('backup:', backup);
console.log('default lock timeout ms: 60000');
console.log('live queue rm/rename fallback: REMOVED');
console.log('Windows EPERM fallback: copy fsynced temp over canonical queue');
console.log('next: node --check CORE\\TaskQueue.js');
