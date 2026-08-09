"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function clean(v) { return String(v ?? "").trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/\s+/g, " "); }
function money(v) {
  const s = clean(v).replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function hash(parts) {
  return crypto.createHash("sha256").update(parts.map(clean).join("\u001f")).digest("hex");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function eachCsvRow(file, cb) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let rowNo = 0;
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
      continue;
    }
    rowNo++;
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    await cb(row, rowNo);
  }
}

function listCsv(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(x => x.isFile() && /\.csv$/i.test(x.name))
    .map(x => path.join(dir, x.name))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, headers, rows) {
  const out = fs.createWriteStream(file, { encoding: "utf8" });
  out.write(headers.map(csvEscape).join(",") + "\n");
  for (const row of rows) out.write(headers.map(h => csvEscape(row[h])).join(",") + "\n");
  out.end();
}

async function buildTexas(txDir) {
  const files = listCsv(txDir);
  const seen = new Set();
  const vendors = new Map();
  let rows = 0, uniqueLines = 0, dupes = 0, realizedSales = 0;

  for (const file of files) {
    await eachCsvRow(file, async (row) => {
      rows++;
      const salesFact = clean(row.sales_fact_number);
      const fp = hash([
        row.vendor_name, row.contract_number, row.invoice_number, row.po_number,
        row.order_date, row.purchase_amount, row.customer_name, row.rfo_number,
        row.purchase_month, row.report_received_month, row.brand_name,
        row.order_quantity, row.unit_price, row.reseller_name
      ]);
      const dedupKey = salesFact ? `${salesFact.toUpperCase()}\u001f${fp}` : `BLANK\u001f${fp}`;
      if (seen.has(dedupKey)) { dupes++; return; }
      seen.add(dedupKey);
      uniqueLines++;

      const amount = money(row.purchase_amount) ?? 0;
      realizedSales += amount;
      const vendorName = clean(row.vendor_name);
      const vendorKey = norm(vendorName) || `UNKNOWN\u001f${clean(row.vendor_address)}\u001f${clean(row.vendor_zip)}`;
      if (!vendors.has(vendorKey)) vendors.set(vendorKey, {
        state: "TX",
        vendor_name: vendorName,
        vendor_name_norm: norm(vendorName),
        vendor_id: "",
        realized_sales: 0,
        purchase_document_value: "",
        contract_relationship_count: 0,
        purchase_document_count: "",
        contract_numbers: new Set(),
        source_role: "SLED_PRIME_OR_VENDOR_REPORTED_SELLER",
        source_semantics: "DIR_REPORTED_REALIZED_SALES"
      });
      const v = vendors.get(vendorKey);
      v.realized_sales += amount;
      const c = clean(row.contract_number);
      if (c) v.contract_numbers.add(c);
    });
  }

  const rowsOut = [...vendors.values()].map(v => ({
    state: v.state,
    vendor_name: v.vendor_name,
    vendor_name_norm: v.vendor_name_norm,
    vendor_id: v.vendor_id,
    realized_sales: Number(v.realized_sales.toFixed(2)),
    purchase_document_value: v.purchase_document_value,
    contract_relationship_count: v.contract_numbers.size,
    purchase_document_count: v.purchase_document_count,
    source_role: v.source_role,
    source_semantics: v.source_semantics
  }));

  return {
    rowsAudited: rows,
    uniqueTransactionLines: uniqueLines,
    exactDuplicateRowsRemoved: dupes,
    dedupedRealizedSales: Number(realizedSales.toFixed(2)),
    vendorCount: rowsOut.length,
    rows: rowsOut
  };
}

async function buildCalifornia(caFile) {
  const groups = new Map();
  let rows = 0;
  await eachCsvRow(caFile, async (row) => {
    rows++;
    const supplier = clean(row["Supplier ID"]);
    const doc = clean(row["Purchase Document #"]);
    if (!supplier || !doc) return;
    const key = `${supplier}\u001f${doc}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      supplier,
      supplierName: clean(row["Supplier Name"]),
      doc,
      lpa: clean(row["LPA Contract ID"]),
      version: clean(row["Version"]),
      amount: money(row["Grand Total"]),
      department: clean(row["Department"]),
      departmentName: clean(row["Department Name"]),
      startDate: clean(row["Start Date"]),
      endDate: clean(row["End Date"]),
      status: clean(row["Status"])
    });
  });

  const vendors = new Map();
  let invalidOrConflictingGroups = 0;
  let authorizedPurchaseDocumentValue = 0;

  for (const group of groups.values()) {
    const sorted = group.map((x, i) => ({ ...x, i, nv: Number(x.version) })).sort((a,b) => {
      const av = Number.isFinite(a.nv) ? a.nv : -Infinity;
      const bv = Number.isFinite(b.nv) ? b.nv : -Infinity;
      return bv - av || b.i - a.i;
    });
    const chosen = sorted[0];
    const amounts = [...new Set(group.map(x => x.amount).filter(x => x !== null))];
    const conflict = amounts.length > 1;
    const invalid = chosen.amount === null;
    if (conflict || invalid) invalidOrConflictingGroups++;
    else authorizedPurchaseDocumentValue += chosen.amount;

    const key = chosen.supplier;
    if (!vendors.has(key)) vendors.set(key, {
      state: "CA",
      vendor_name: chosen.supplierName,
      vendor_name_norm: norm(chosen.supplierName),
      vendor_id: chosen.supplier,
      realized_sales: "",
      purchase_document_value: 0,
      contract_relationship_count: "",
      purchase_document_count: 0,
      source_role: "SLED_PRIME_PURCHASE_DOCUMENT_AWARDEE",
      source_semantics: "SCPRS_PURCHASE_DOCUMENTS_VALUE_RESTRICTED"
    });
    const v = vendors.get(key);
    v.purchase_document_count++;
    if (!conflict && !invalid) v.purchase_document_value += chosen.amount;
  }

  const rowsOut = [...vendors.values()].map(v => ({
    ...v,
    purchase_document_value: Number(v.purchase_document_value.toFixed(2))
  }));

  return {
    rowsAudited: rows,
    distinctSupplierPurchaseDocuments: groups.size,
    invalidOrConflictingGroups,
    authorizedPurchaseDocumentValue: Number(authorizedPurchaseDocumentValue.toFixed(2)),
    vendorCount: rowsOut.length,
    rows: rowsOut
  };
}

(async () => {
  const txDir = path.resolve(arg("--tx-dir"));
  const caFile = path.resolve(arg("--ca-file"));
  const authorizationFile = path.resolve(arg("--authorization"));
  const outDir = path.resolve(arg("--out-dir"));

  for (const [label, p] of [["tx-dir", txDir], ["ca-file", caFile], ["authorization", authorizationFile]]) {
    if (!p || !fs.existsSync(p)) throw new Error(`--${label} must exist`);
  }
  const authorization = JSON.parse(fs.readFileSync(authorizationFile, "utf8").replace(/^\uFEFF/, ""));
  if (!authorization.ok) throw new Error("Normalization authorization must PASS before staging build");
  if (authorization.texas?.status !== "NORMALIZATION_AUTHORIZED_TO_STAGING") throw new Error("Texas staging is not authorized");
  if (authorization.california?.status !== "NORMALIZATION_AUTHORIZED_TO_STAGING_WITH_VALUE_RESTRICTIONS") throw new Error("California staging is not authorized");

  ensureDir(outDir);
  const tx = await buildTexas(txDir);
  const ca = await buildCalifornia(caFile);

  const txFile = path.join(outDir, "TX_VENDOR_AGGREGATES.csv");
  const caFileOut = path.join(outDir, "CA_VENDOR_AGGREGATES.csv");
  const combinedFile = path.join(outDir, "CA_TX_VENDOR_AGGREGATES.csv");
  const headers = ["state","vendor_name","vendor_name_norm","vendor_id","realized_sales","purchase_document_value","contract_relationship_count","purchase_document_count","source_role","source_semantics"];
  writeCsv(txFile, headers, tx.rows);
  writeCsv(caFileOut, headers, ca.rows);
  writeCsv(combinedFile, headers, tx.rows.concat(ca.rows));

  const manifest = {
    ok: true,
    service: "LOCAL_STATE_STAGING_AGGREGATES",
    mode: "STAGING_ONLY_NO_ORION_WRITES",
    generatedAt: new Date().toISOString(),
    texas: { ...tx, rows: undefined },
    california: { ...ca, rows: undefined },
    outputs: { txFile, caFile: caFileOut, combinedFile },
    semantics: {
      texasRealizedSales: "DEDUPE_EXACT_TRANSACTION_LINES_THEN_SUM_PURCHASE_AMOUNT",
      texasAwardedValue: "NOT_AUTHORIZED",
      texasContractCount: "DISTINCT_CONTRACT_RELATIONSHIPS_ONLY_NOT_AWARD_COUNT",
      californiaPurchaseDocumentCount: "DISTINCT_SUPPLIER_ID_PLUS_PURCHASE_DOCUMENT",
      californiaPurchaseDocumentValue: "LATEST_VERSION_ONLY_WHEN_AMOUNT_GROUP_IS_VALID_AND_NONCONFLICTING",
      californiaAwardedValue: "NOT_AUTHORIZED"
    },
    federalReconciliationPerformed: false,
    orionWritesPerformed: false,
    marketingLaunchPerformed: false
  };
  const manifestFile = path.join(outDir, "LOCAL_STATE_STAGING_MANIFEST.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify({
    ok: true,
    service: manifest.service,
    texas: manifest.texas,
    california: manifest.california,
    outputs: manifest.outputs,
    manifestFile
  }, null, 2));
  console.log("LOCAL_STATE_STAGING_AGGREGATES_STATUS=PASS");
})().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
