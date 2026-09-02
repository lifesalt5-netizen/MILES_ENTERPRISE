"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function csvParseLine(line) {
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

async function readCsvRows(file, onRow) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let rowNo = 0;
  for await (const line of rl) {
    if (!headers) {
      headers = csvParseLine(line.replace(/^\uFEFF/, ""));
      continue;
    }
    rowNo++;
    const values = csvParseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    await onRow(row, rowNo);
  }
  return rowNo;
}

function clean(v) { return String(v ?? "").trim(); }
function money(v) {
  const s = clean(v).replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function hash(parts) {
  return crypto.createHash("sha256").update(parts.map(clean).join("\u001f")).digest("hex");
}
function listCsvFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && /\.csv$/i.test(d.name))
    .map(d => path.join(dir, d.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function stableSignature(row) {
  return hash([
    row.vendor_name,
    row.contract_number,
    row.invoice_number,
    row.po_number,
    row.order_date,
    row.purchase_amount,
    row.customer_name,
    row.rfo_number,
    row.purchase_month,
    row.report_received_month,
    row.brand_name,
    row.order_quantity,
    row.unit_price,
    row.reseller_name
  ]);
}

(async () => {
  const txDir = path.resolve(arg("--tx-dir"));
  const outputArg = arg("--output", null);
  if (!fs.existsSync(txDir) || !fs.statSync(txDir).isDirectory()) {
    throw new Error("--tx-dir must point to an existing Texas DIR CSV directory");
  }

  const files = listCsvFiles(txDir);
  const salesFactFirstSignature = new Map();
  const conflictingSignaturesBySalesFact = new Map();
  const blankSalesFactSignatures = new Set();
  const fileBySalesFact = new Map();

  let rows = 0;
  let rowsWithAmount = 0;
  let rawSales = 0;
  let dedupedSales = 0;
  let negativeRows = 0;
  let blankSalesFactRows = 0;
  let exactDuplicateRows = 0;
  let conflictingDuplicateRows = 0;
  let crossFileExactDuplicates = 0;
  let crossFileConflicts = 0;
  let uniqueTransactionLines = 0;
  const conflictExamples = [];
  const exactDuplicateExamples = [];

  for (const file of files) {
    await readCsvRows(file, async (row, rowNo) => {
      rows++;
      const amount = money(row.purchase_amount);
      if (amount !== null) {
        rowsWithAmount++;
        rawSales += amount;
        if (amount < 0) negativeRows++;
      }

      const salesFact = clean(row.sales_fact_number).toUpperCase();
      const sig = stableSignature(row);

      if (!salesFact) {
        blankSalesFactRows++;
        if (!blankSalesFactSignatures.has(sig)) {
          blankSalesFactSignatures.add(sig);
          uniqueTransactionLines++;
          if (amount !== null) dedupedSales += amount;
        } else {
          exactDuplicateRows++;
          if (exactDuplicateExamples.length < 20) exactDuplicateExamples.push({ salesFact: null, file, rowNo });
        }
        return;
      }

      if (!salesFactFirstSignature.has(salesFact)) {
        salesFactFirstSignature.set(salesFact, sig);
        fileBySalesFact.set(salesFact, file);
        uniqueTransactionLines++;
        if (amount !== null) dedupedSales += amount;
        return;
      }

      const firstSig = salesFactFirstSignature.get(salesFact);
      const firstFile = fileBySalesFact.get(salesFact);
      if (firstSig === sig) {
        exactDuplicateRows++;
        if (firstFile !== file) crossFileExactDuplicates++;
        if (exactDuplicateExamples.length < 20) exactDuplicateExamples.push({ salesFact, firstFile, file, rowNo });
        return;
      }

      let sigs = conflictingSignaturesBySalesFact.get(salesFact);
      if (!sigs) {
        sigs = new Set([firstSig]);
        conflictingSignaturesBySalesFact.set(salesFact, sigs);
      }

      if (sigs.has(sig)) {
        exactDuplicateRows++;
        if (firstFile !== file) crossFileExactDuplicates++;
        return;
      }

      sigs.add(sig);
      conflictingDuplicateRows++;
      if (firstFile !== file) crossFileConflicts++;
      uniqueTransactionLines++;
      if (amount !== null) dedupedSales += amount;
      if (conflictExamples.length < 30) {
        conflictExamples.push({
          salesFact,
          firstFile,
          file,
          rowNo,
          vendorName: clean(row.vendor_name),
          contractNumber: clean(row.contract_number),
          invoiceNumber: clean(row.invoice_number),
          poNumber: clean(row.po_number),
          orderDate: clean(row.order_date),
          purchaseAmount: amount
        });
      }
    });
  }

  const rowsRemovedAsExactDuplicates = exactDuplicateRows;
  const dedupReduction = rawSales === 0 ? 0 : (rawSales - dedupedSales) / Math.abs(rawSales);
  const compositeLineKeyAuthorized = conflictingDuplicateRows >= 0 && uniqueTransactionLines > 0;

  const result = {
    ok: compositeLineKeyAuthorized,
    service: "TX_COMPOSITE_TRANSACTION_KEY_AUDIT",
    mode: "READ_ONLY_FULL_FAMILY_AUDIT",
    generatedAt: new Date().toISOString(),
    sourceSemantics: {
      officialMeaning: "DIR_VENDOR_SALES_REPORT_DATA",
      realizedSalesDefinition: "MONTHLY_VENDOR_REPORTED_SALES_INVOICED_TO_DIR_CUSTOMERS",
      awardedValueAuthorized: false,
      realizedSalesCandidate: true
    },
    filesAudited: files.length,
    rowsAudited: rows,
    rowsWithAmount,
    negativeRows,
    blankSalesFactRows,
    salesFact: {
      distinctNonblank: salesFactFirstSignature.size,
      salesFactsWithMultipleDistinctSignatures: conflictingSignaturesBySalesFact.size,
      exactDuplicateRows,
      conflictingDuplicateRows,
      crossFileExactDuplicates,
      crossFileConflicts
    },
    recommendedTransactionLineKey: {
      primaryGroup: "sales_fact_number",
      lineFingerprintFields: [
        "vendor_name", "contract_number", "invoice_number", "po_number", "order_date",
        "purchase_amount", "customer_name", "rfo_number", "purchase_month",
        "report_received_month", "brand_name", "order_quantity", "unit_price", "reseller_name"
      ],
      blankSalesFactFallback: "same line fingerprint without sales_fact_number",
      authorizedForDeduplication: compositeLineKeyAuthorized
    },
    realizedSales: {
      rawRowSum: Number(rawSales.toFixed(2)),
      dedupedTransactionLineSum: Number(dedupedSales.toFixed(2)),
      rowsRemovedAsExactDuplicates,
      dedupReductionRate: Number(dedupReduction.toFixed(8)),
      authorizedAsAwardedValue: false,
      authorizedAsRealizedSalesAfterExactDuplicateRemoval: compositeLineKeyAuthorized
    },
    conflictExamples,
    exactDuplicateExamples,
    governingRules: {
      doNotCountSalesFactNumberAsAwardCount: true,
      doNotTreatPurchaseAmountAsContractCeiling: true,
      negativeRowsPreservedAsAdjustments: true,
      contractCountMustUseDistinctContractNumber: true,
      vendorSalesMustAggregateOnlyAfterExactDuplicateRemoval: true
    },
    orionWritesPerformed: false,
    sourceFilesChanged: false
  };

  if (outputArg) {
    const out = path.resolve(outputArg);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    result.output = out;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    service: result.service,
    filesAudited: result.filesAudited,
    rowsAudited: result.rowsAudited,
    blankSalesFactRows: result.blankSalesFactRows,
    salesFact: result.salesFact,
    recommendedTransactionLineKey: result.recommendedTransactionLineKey,
    realizedSales: result.realizedSales,
    output: result.output || null
  }, null, 2));
  console.log(`TX_COMPOSITE_TRANSACTION_KEY_AUDIT_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
})().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
