'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function findEocd(file) {
  const stat = fs.statSync(file);
  const tailSize = Math.min(stat.size, 22 + 65535 + 1024);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(tailSize);
    fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize);
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        return {
          entries: buf.readUInt16LE(i + 10),
          centralSize: buf.readUInt32LE(i + 12),
          centralOffset: buf.readUInt32LE(i + 16),
          fileSize: stat.size
        };
      }
    }
  } finally { fs.closeSync(fd); }
  throw new Error(`ZIP_EOCD_NOT_FOUND:${file}`);
}

function readCentralDirectory(file, maxCentralBytes = 128 * 1024 * 1024) {
  const eocd = findEocd(file);
  if (eocd.centralSize > maxCentralBytes) throw new Error(`ZIP_CENTRAL_DIRECTORY_TOO_LARGE:${eocd.centralSize}`);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(eocd.centralSize);
    fs.readSync(fd, buf, 0, buf.length, eocd.centralOffset);
    const entries = [];
    let i = 0;
    while (i + 46 <= buf.length) {
      if (buf.readUInt32LE(i) !== 0x02014b50) break;
      const method = buf.readUInt16LE(i + 10);
      const crc32 = buf.readUInt32LE(i + 16);
      const compressedSize = buf.readUInt32LE(i + 20);
      const uncompressedSize = buf.readUInt32LE(i + 24);
      const nameLen = buf.readUInt16LE(i + 28);
      const extraLen = buf.readUInt16LE(i + 30);
      const commentLen = buf.readUInt16LE(i + 32);
      const localHeaderOffset = buf.readUInt32LE(i + 42);
      const name = buf.subarray(i + 46, i + 46 + nameLen).toString('utf8');
      entries.push({ name, method, crc32, compressedSize, uncompressedSize, localHeaderOffset });
      i += 46 + nameLen + extraLen + commentLen;
    }
    return { eocd, entries };
  } finally { fs.closeSync(fd); }
}

function dataStartForEntry(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(30);
    fs.readSync(fd, header, 0, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP_LOCAL_HEADER_INVALID:${entry.name}`);
    const nameLen = header.readUInt16LE(26);
    const extraLen = header.readUInt16LE(28);
    return entry.localHeaderOffset + 30 + nameLen + extraLen;
  } finally { fs.closeSync(fd); }
}

async function readFirstLine(file, entry, maxBytes = 256 * 1024) {
  const start = dataStartForEntry(file, entry);
  const end = start + entry.compressedSize - 1;
  const source = fs.createReadStream(file, { start, end });
  const stream = entry.method === 8 ? source.pipe(zlib.createInflateRaw()) : entry.method === 0 ? source : null;
  if (!stream) {
    source.destroy();
    return { ok: false, reason: `UNSUPPORTED_COMPRESSION_METHOD_${entry.method}` };
  }
  return new Promise(resolve => {
    let text = '';
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      try { stream.destroy(); } catch {}
      try { source.destroy(); } catch {}
      resolve(value);
    };
    stream.on('data', chunk => {
      text += chunk.toString('utf8');
      const nl = text.search(/\r?\n/);
      if (nl >= 0) return done({ ok: true, line: text.slice(0, nl).replace(/^\uFEFF/, '') });
      if (Buffer.byteLength(text, 'utf8') >= maxBytes) return done({ ok: false, reason: 'FIRST_LINE_EXCEEDS_LIMIT' });
    });
    stream.on('end', () => done({ ok: true, line: text.replace(/^\uFEFF/, '') }));
    stream.on('error', error => done({ ok: false, reason: `STREAM_ERROR:${error.message}` }));
    source.on('error', error => done({ ok: false, reason: `SOURCE_ERROR:${error.message}` }));
  });
}

class OrionOfficialArchiveInspectorService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.acquisitionPath = path.resolve(options.acquisitionPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_staging_acquisition.json'));
    this.reportPath = path.resolve(options.reportPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_archive_inspection.json'));
  }

  async run() {
    const acquisition = readJson(this.acquisitionPath);
    if (acquisition?.ok !== true || acquisition?.nextStep !== 'INSPECT_ARCHIVES_AND_BUILD_STAGING_DB_ONLY') throw new Error('STAGING_ACQUISITION_NOT_GREEN');
    const downloads = Array.isArray(acquisition.downloads) ? acquisition.downloads : [];
    if (downloads.length !== 2) throw new Error('EXPECTED_TWO_STAGED_ARCHIVES');

    const archives = [];
    for (const row of downloads) {
      const file = path.resolve(row.path);
      const stat = fs.statSync(file);
      if (stat.size !== Number(row.downloadedBytes)) throw new Error(`STAGED_ARCHIVE_SIZE_CHANGED:${path.basename(file)}`);
      const { eocd, entries } = readCentralDirectory(file);
      const csvEntries = entries.filter(x => /\.csv$/i.test(x.name));
      const headers = [];
      for (const entry of csvEntries.slice(0, 8)) {
        const firstLine = await readFirstLine(file, entry);
        headers.push({ name: entry.name, uncompressedSize: entry.uncompressedSize, compressedSize: entry.compressedSize, method: entry.method, firstLine });
      }
      archives.push({
        role: row.role,
        fileName: row.fileName,
        path: file,
        compressedArchiveBytes: stat.size,
        centralDirectoryEntries: entries.length,
        csvEntryCount: csvEntries.length,
        totalDeclaredUncompressedBytes: entries.reduce((s, x) => s + Number(x.uncompressedSize || 0), 0),
        entries: entries.slice(0, 250).map(x => ({ name: x.name, compressedSize: x.compressedSize, uncompressedSize: x.uncompressedSize, method: x.method })),
        sampledCsvHeaders: headers
      });
    }

    const result = {
      ok: true,
      service: 'ORION_OFFICIAL_ARCHIVE_INSPECTION',
      generatedAt: new Date().toISOString(),
      archives,
      nextStep: 'DESIGN_STAGING_IMPORT_FROM_OBSERVED_ARCHIVE_SCHEMA',
      safety: {
        readOnlyArchives: true,
        archivesExtracted: false,
        sourceFilesModified: false,
        productionDatabaseModified: false,
        stagingDatabaseCreated: false,
        stagingDatabasePromoted: false
      }
    };
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionOfficialArchiveInspectorService;
module.exports.findEocd = findEocd;
module.exports.readCentralDirectory = readCentralDirectory;
module.exports.readFirstLine = readFirstLine;
