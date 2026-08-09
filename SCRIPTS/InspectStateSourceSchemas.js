"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

function inferDelimiter(line, ext) {
  if (ext === ".tsv") return "\t";
  const comma = (line.match(/,/g) || []).length;
  const tab = (line.match(/\t/g) || []).length;
  const pipe = (line.match(/\|/g) || []).length;
  if (tab > comma && tab >= pipe) return "\t";
  if (pipe > comma && pipe > tab) return "|";
  return ",";
}

function classifyHeaders(headers) {
  const h = new Set(headers.map(normalizeHeader));
  const any = (...names) => names.some((name) => h.has(name));
  const contains = (...parts) => [...h].some((name) => parts.some((part) => name.includes(part)));

  return {
    company: any("company", "vendor_name", "supplier_name", "business_name", "legal_business_name", "payee_name") || contains("vendor", "supplier", "company", "business_name", "payee"),
    uei: any("uei", "unique_entity_id", "unique_entity_identifier") || contains("uei", "unique_entity"),
    email: any("email", "email_address", "contact_email") || contains("email"),
    awardId: any("award_id", "contract_id", "purchase_order", "po_number", "contract_number", "document_number") || contains("award_id", "contract", "purchase_order", "po_number", "document"),
    awardAmount: any("award_amount", "amount", "spend", "payment_amount", "contract_amount", "total_amount", "sales") || contains("amount", "spend", "payment", "sales"),
    awardDate: any("award_date", "date", "contract_date", "po_date", "payment_date") || contains("award_date", "contract_date", "payment_date", "po_date"),
    agency: any("agency", "department", "purchasing_agency", "buyer") || contains("agency", "department", "buyer"),
    address: contains("address", "city", "state", "zip", "postal"),
    naics: contains("naics"),
    vendorId: any("vendor_id", "supplier_id", "payee_id") || contains("vendor_id", "supplier_id", "payee_id")
  };
}

function familyKey(filePath) {
  const dir = path.dirname(filePath);
  let base = path.basename(filePath, path.extname(filePath));
  base = base.replace(/(?:_|-)?\d+(?:\.\d+)?$/i, "");
  base = base.replace(/(?:_|-)?(?:part|page|chunk|batch)(?:_|-)?\d+$/i, "");
  return path.join(dir, base).toLowerCase();
}

async function inspectDelimited(filePath, ext, sampleRows) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headerLine = null;
  const samples = [];
  let delimiter = ",";

  for await (const line of rl) {
    if (headerLine === null) {
      if (!line.trim()) continue;
      headerLine = line;
      delimiter = inferDelimiter(line, ext);
      continue;
    }
    if (samples.length < sampleRows && line.trim()) samples.push(line);
    if (samples.length >= sampleRows) break;
  }
  rl.close();
  stream.destroy();

  if (headerLine === null) {
    return { readable: true, empty: true, headers: [], normalizedHeaders: [], sampleRows: [], delimiter: null };
  }

  const headers = parseDelimitedLine(headerLine, delimiter).map((x) => x.replace(/^\uFEFF/, "").trim());
  const rows = samples.map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const row = {};
    for (let i = 0; i < Math.min(headers.length, values.length); i += 1) {
      row[headers[i]] = values[i];
    }
    return row;
  });

  return {
    readable: true,
    empty: false,
    delimiter: delimiter === "\t" ? "TAB" : delimiter,
    headers,
    normalizedHeaders: headers.map(normalizeHeader),
    fieldSignals: classifyHeaders(headers),
    sampleRows: rows
  };
}

async function inspectJson(filePath, sampleRows) {
  const stat = fs.statSync(filePath);
  if (stat.size > 25 * 1024 * 1024) {
    return { readable: false, reason: "JSON_TOO_LARGE_FOR_SAFE_SAMPLE", sizeBytes: stat.size };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : [parsed]);
  const samples = rows.slice(0, sampleRows);
  const headers = [...new Set(samples.flatMap((row) => row && typeof row === "object" ? Object.keys(row) : []))];
  return {
    readable: true,
    empty: rows.length === 0,
    headers,
    normalizedHeaders: headers.map(normalizeHeader),
    fieldSignals: classifyHeaders(headers),
    sampleRows: samples
  };
}

async function inspectCandidate(candidate, sampleRows) {
  const filePath = candidate.path;
  const ext = (candidate.extension || path.extname(filePath)).toLowerCase();
  const base = {
    path: filePath,
    extension: ext,
    states: candidate.states || [],
    signals: candidate.signals || [],
    sizeBytes: candidate.sizeBytes || null,
    modifiedAt: candidate.modifiedAt || null,
    familyKey: familyKey(filePath)
  };

  try {
    if ([".csv", ".tsv", ".txt"].includes(ext)) {
      return { ...base, ...(await inspectDelimited(filePath, ext, sampleRows)) };
    }
    if (ext === ".json") {
      return { ...base, ...(await inspectJson(filePath, sampleRows)) };
    }
    if ([".xlsx", ".xls"].includes(ext)) {
      return { ...base, readable: false, reason: "SPREADSHEET_SCHEMA_REQUIRES_XLSX_READER" };
    }
    return { ...base, readable: false, reason: "UNSUPPORTED_EXTENSION" };
  } catch (error) {
    return { ...base, readable: false, reason: "INSPECTION_ERROR", error: error.message };
  }
}

(async () => {
  const discoveryPath = path.resolve(arg("--discovery"));
  const outputPath = arg("--output", null);
  const sampleRows = Math.max(0, Math.min(5, Number(arg("--sample-rows", "2")) || 2));

  if (!discoveryPath || !fs.existsSync(discoveryPath)) {
    throw new Error("--discovery must point to an existing STATE_VENDOR_SOURCE_DISCOVERY.json file");
  }

  const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8").replace(/^\uFEFF/, ""));
  const candidates = Array.isArray(discovery.candidates) ? discovery.candidates : [];
  const inspected = [];

  for (const candidate of candidates) {
    inspected.push(await inspectCandidate(candidate, sampleRows));
  }

  const families = {};
  for (const row of inspected) {
    if (!families[row.familyKey]) {
      families[row.familyKey] = {
        familyKey: row.familyKey,
        states: [],
        files: 0,
        totalBytes: 0,
        extensions: [],
        headerSignatures: [],
        paths: []
      };
    }
    const f = families[row.familyKey];
    f.files += 1;
    f.totalBytes += Number(row.sizeBytes || 0);
    f.states.push(...(row.states || []));
    f.extensions.push(row.extension);
    f.paths.push(row.path);
    if (row.normalizedHeaders?.length) f.headerSignatures.push(row.normalizedHeaders.join("|"));
  }

  const familyList = Object.values(families).map((f) => ({
    ...f,
    states: [...new Set(f.states)].sort(),
    extensions: [...new Set(f.extensions)].sort(),
    headerSignatureCount: new Set(f.headerSignatures).size,
    likelyChunkFamily: f.files > 1
  })).sort((a, b) => b.files - a.files || b.totalBytes - a.totalBytes);

  const result = {
    ok: true,
    service: "STATE_SOURCE_SCHEMA_INSPECTION",
    mode: "READ_ONLY",
    discoveryPath,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    inspectedCount: inspected.length,
    readableCount: inspected.filter((x) => x.readable).length,
    unreadableCount: inspected.filter((x) => !x.readable).length,
    familyCount: familyList.length,
    chunkFamilyCount: familyList.filter((x) => x.likelyChunkFamily).length,
    families: familyList,
    sources: inspected,
    sourceFilesChanged: false,
    writesPerformed: Boolean(outputPath)
  };

  if (outputPath) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(result, null, 2));
    result.output = target;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    service: result.service,
    mode: result.mode,
    candidateCount: result.candidateCount,
    readableCount: result.readableCount,
    unreadableCount: result.unreadableCount,
    familyCount: result.familyCount,
    chunkFamilyCount: result.chunkFamilyCount,
    topFamilies: familyList.slice(0, 20).map((f) => ({
      familyKey: f.familyKey,
      states: f.states,
      files: f.files,
      totalBytes: f.totalBytes,
      headerSignatureCount: f.headerSignatureCount,
      likelyChunkFamily: f.likelyChunkFamily
    })),
    output: result.output || null
  }, null, 2));
  console.log("STATE_SOURCE_SCHEMA_INSPECTION_STATUS=COMPLETE");
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
