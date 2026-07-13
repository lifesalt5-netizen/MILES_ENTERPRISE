const fs = require('fs');
const { changeQueue, outputDir } = require('./paths');

function readChangeQueue() {
  if (!fs.existsSync(changeQueue)) return [];
  const lines = fs.readFileSync(changeQueue, 'utf8').trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map(line => {
    const cols = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] || '').replace(/^"|"$/g, '')]));
  });
}

function writeAudit(session, screenshot) {
  fs.mkdirSync(outputDir, { recursive: true });
  const changes = readChangeQueue();
  const report = {
    timestamp: new Date().toISOString(),
    session,
    screenshot,
    queued_changes: changes.filter(c => c.Status === 'Queued').map(c => ({
      ChangeID: c.ChangeID,
      Page: c.Page,
      ChangeType: c.ChangeType,
      Priority: c.Priority,
      ApprovedByKevin: c.ApprovedByKevin,
      Notes: c.Notes
    }))
  };
  const file = `${outputDir}\\b12_audit_${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

module.exports = { writeAudit };
