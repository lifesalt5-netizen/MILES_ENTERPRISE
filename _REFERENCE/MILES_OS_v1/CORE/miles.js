const fs = require('fs');
const path = require('path');
const { log, ROOT } = require('./logger');
const { requiresApproval } = require('./authority');

const workFile = path.join(ROOT, 'MILES_WORK_REGISTRY.csv');
const outputFile = path.join(ROOT, 'TASK_QUEUE', 'NEXT_ACTIONS.csv');

function parseCsvSimple(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map(line => {
    const cols = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] || '']));
  });
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  if (!fs.existsSync(workFile)) {
    console.error('Missing MILES_WORK_REGISTRY.csv');
    process.exit(1);
  }
  const rows = parseCsvSimple(fs.readFileSync(workFile, 'utf8'));
  const open = rows.filter(r => ['Queued', 'Active', 'Blocked'].includes(r.Status));
  const outRows = open.map(r => {
    const auth = requiresApproval(r.System, r.WorkItem);
    return {
      Timestamp: new Date().toISOString(),
      WorkID: r.WorkID,
      System: r.System,
      WorkItem: r.WorkItem,
      Priority: r.Priority,
      Status: r.Status,
      Owner: r.Owner,
      MilesCanExecute: auth.allowed ? 'Yes' : 'No',
      ApprovalRequirement: auth.approval
    };
  });
  const headers = Object.keys(outRows[0] || {Timestamp:'',WorkID:'',System:'',WorkItem:'',Priority:'',Status:'',Owner:'',MilesCanExecute:'',ApprovalRequirement:''});
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, headers.join(',') + '\n' + outRows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n'));
  log('MILES_CORE', 'Generated next actions', 'Success', outputFile);
  console.log(`MILES next actions created: ${outputFile}`);
}

main();
