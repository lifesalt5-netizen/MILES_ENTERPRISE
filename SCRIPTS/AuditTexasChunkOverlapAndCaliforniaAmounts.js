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
      out.push(cur);
      cur = "";
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
    await onRow(row, rowNo, headers);
  }
  return { headers, rowNo };
}

function clean(v) { return String(v ?? "").trim(); }
function money(v) {
  const s = clean(v).replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function hashKey(parts) {
  return crypto.createHash("sha256").update(parts.map(clean).join("\u001f")).digest("hex");
}

function listCsvFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && /\.csv$/i.test(d.name))
    .map(d => path.join(dir, d.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function auditTexas(dir) {
  const files = listCsvFiles(dir);
  const keySets = {
    salesFact: new Set(),
    invoicePoContractDateVendorAmount: new Set()
  };
  const seenFileByKey = new Map();
  const duplicateExamples = [];
  let rows = 0, blankSalesFact = 0, duplicateSalesFact = 0, crossFileDuplicateSalesFact = 0;
  let realizedSales = 0, realizedSalesRows = 0, negativeSalesRows = 0;
  const contracts = new Set(), vendors = new Set(), invoices = new Set(), pos = new Set();
  const fileStats = [];

  for (const file of files) {
    let fileRows = 0, fileAmount = 0;
    await readCsvRows(file, async (row) => {
      rows++; fileRows++;
      const vendor = clean(row.vendor_name);
      const contract = clean(row.contract_number);
      const invoice = clean(row.invoice_number);
      const po = clean(row.po_number);
      const date = clean(row.order_date);
      const salesFact = clean(row.sales_fact_number);
      const amount = money(row.purchase_amount);
      if (vendor) vendors.add(vendor.toUpperCase());
      if (contract) contracts.add(contract.toUpperCase());
      if (invoice) invoices.add(invoice.toUpperCase());
      if (po) pos.add(po.toUpperCase());
      if (amount !== null) {
        realizedSales += amount;
        fileAmount += amount;
        realizedSalesRows++;
        if (amount < 0) negativeSalesRows++;
      }

      if (!salesFact) {
        blankSalesFact++;
      } else {
        const key = salesFact.toUpperCase();
        if (keySets.salesFact.has(key)) {
          duplicateSalesFact++;
          const priorFile = seenFileByKey.get(key);
          if (priorFile && priorFile !== file) crossFileDuplicateSalesFact++;
          if (duplicateExamples.length < 20) duplicateExamples.push({ keyType: "sales_fact_number", key, priorFile, file });
        } else {
          keySets.salesFact.add(key);
          seenFileByKey.set(key, file);
        }
      }

      const composite = hashKey([vendor, contract, invoice, po, date, amount]);
      keySets.invoicePoContractDateVendorAmount.add(composite);
    });
    fileStats.push({ file, rows: fileRows, purchaseAmountSum: fileAmount });
  }

  const salesFactUniqueness = rows ? keySets.salesFact.size / rows : 0;
  const noCrossFileOverlap = crossFileDuplicateSalesFact === 0;
  const salesFactUsable = salesFactUniqueness >= 0.995 && duplicateSalesFact === 0;

  return {
    filesAudited: files.length,
    rowsAudited: rows,
    salesFactNumber: {
      blankRows: blankSalesFact,
      distinctKeys: keySets.salesFact.size,
      duplicateRows: duplicateSalesFact,
      crossFileDuplicateRows: crossFileDuplicateSalesFact,
      uniquenessRate: Number(salesFactUniqueness.toFixed(6)),
      candidateTransactionKeyAuthorized: salesFactUsable
    },
    overlap: {
      fullFamilyCrossFileOverlapDetected: !noCrossFileOverlap,
      safeToTreatFilesAsNonOverlappingBySalesFactNumber: salesFactUsable && noCrossFileOverlap
    },
    realizedSales: {
      field: "purchase_amount",
      semanticLabel: "REPORTED_DIR_REALIZED_SALES",
      rowsWithAmount: realizedSalesRows,
      negativeRows: negativeSalesRows,
      sumAllRows: Number(realizedSales.toFixed(2)),
      authorizedAsAwardedValue: false,
      authorizedAsRealizedSales: salesFactUsable && noCrossFileOverlap
    },
    dimensions: {
      distinctVendors: vendors.size,
      distinctContracts: contracts.size,
      distinctInvoices: invoices.size,
      distinctPurchaseOrders: pos.size
    },
    duplicateExamples,
    fileStats
  };
}

async function auditCalifornia(file) {
  const purchaseDocs = new Map();
  const supplierPurchaseDocs = new Map();
  const lpaPurchaseDocs = new Map();
  let rows = 0, populatedGrandTotal = 0, grandTotalSumRaw = 0, invalidGrandTotal = 0;
  let versionedDuplicatePurchaseDocs = 0, conflictingGrandTotalGroups = 0;
  const conflictExamples = [];

  await readCsvRows(file, async (row) => {
    rows++;
    const doc = clean(row["Purchase Document #"]);
    const supplier = clean(row["Supplier ID"]);
    const lpa = clean(row["LPA Contract ID"]);
    const version = clean(row["Version"]);
    const amount = money(row["Grand Total"]);
    if (clean(row["Grand Total"])) {
      if (amount === null) invalidGrandTotal++;
      else { populatedGrandTotal++; grandTotalSumRaw += amount; }
    }
    if (!doc) return;
    if (!purchaseDocs.has(doc)) purchaseDocs.set(doc, []);
    purchaseDocs.get(doc).push({ supplier, lpa, version, amount });
    const sp = `${supplier}\u001f${doc}`;
    if (!supplierPurchaseDocs.has(sp)) supplierPurchaseDocs.set(sp, []);
    supplierPurchaseDocs.get(sp).push({ lpa, version, amount });
    const lp = `${supplier}\u001f${lpa}\u001f${doc}`;
    if (!lpaPurchaseDocs.has(lp)) lpaPurchaseDocs.set(lp, []);
    lpaPurchaseDocs.get(lp).push({ version, amount });
  });

  let duplicatePurchaseDocRows = 0;
  let dedupedGrandTotalBySupplierDoc = 0;
  let dedupedGrandTotalBySupplierLpaDoc = 0;

  for (const [doc, group] of purchaseDocs) {
    if (group.length > 1) duplicatePurchaseDocRows += group.length - 1;
  }

  for (const [key, group] of supplierPurchaseDocs) {
    const versions = new Set(group.map(x => x.version).filter(Boolean));
    if (versions.size > 1) versionedDuplicatePurchaseDocs++;
    const amounts = [...new Set(group.map(x => x.amount).filter(x => x !== null))];
    if (amounts.length > 1) {
      conflictingGrandTotalGroups++;
      if (conflictExamples.length < 20) conflictExamples.push({ key, amounts, versions: [...versions] });
    }
    const numericVersions = group.map((x, i) => ({ ...x, i, nv: Number(x.version) })).sort((a,b) => {
      const av = Number.isFinite(a.nv) ? a.nv : -Infinity;
      const bv = Number.isFinite(b.nv) ? b.nv : -Infinity;
      return bv - av || b.i - a.i;
    });
    const chosen = numericVersions[0];
    if (chosen && chosen.amount !== null) dedupedGrandTotalBySupplierDoc += chosen.amount;
  }

  for (const group of lpaPurchaseDocs.values()) {
    const numericVersions = group.map((x, i) => ({ ...x, i, nv: Number(x.version) })).sort((a,b) => {
      const av = Number.isFinite(a.nv) ? a.nv : -Infinity;
      const bv = Number.isFinite(b.nv) ? b.nv : -Infinity;
      return bv - av || b.i - a.i;
    });
    const chosen = numericVersions[0];
    if (chosen && chosen.amount !== null) dedupedGrandTotalBySupplierLpaDoc += chosen.amount;
  }

  const supplierDocUnique = supplierPurchaseDocs.size === rows;
  const noConflictingAmounts = conflictingGrandTotalGroups === 0;

  return {
    rowsAudited: rows,
    purchaseDocument: {
      distinct: purchaseDocs.size,
      duplicateRows: duplicatePurchaseDocRows,
      supplierPurchaseDocDistinct: supplierPurchaseDocs.size,
      supplierLpaPurchaseDocDistinct: lpaPurchaseDocs.size,
      versionedDuplicateGroups: versionedDuplicatePurchaseDocs
    },
    grandTotal: {
      populatedRows: populatedGrandTotal,
      invalidRows: invalidGrandTotal,
      rawRowSum: Number(grandTotalSumRaw.toFixed(2)),
      dedupedBySupplierPurchaseDocumentLatestVersionSum: Number(dedupedGrandTotalBySupplierDoc.toFixed(2)),
      dedupedBySupplierLpaPurchaseDocumentLatestVersionSum: Number(dedupedGrandTotalBySupplierLpaDoc.toFixed(2)),
      conflictingAmountGroups: conflictingGrandTotalGroups,
      semanticLabel: "PURCHASE_DOCUMENT_GRAND_TOTAL_CANDIDATE",
      authorizedAsAwardedValue: supplierDocUnique && noConflictingAmounts,
      authorizedAsPurchaseDocumentValue: invalidGrandTotal === 0
    },
    recommendedKeys: {
      awardCountCandidate: ["Supplier ID", "Purchase Document #"],
      versionControl: ["Version"],
      lpaContext: ["LPA Contract ID"],
      note: "Count distinct purchase documents, not rows or versions. Treat Grand Total as purchase-document value unless official source semantics separately prove it is total contract award value."
    },
    conflictExamples
  };
}

(async () => {
  const txDir = path.resolve(arg("--tx-dir"));
  const caFile = path.resolve(arg("--ca-file"));
  const outputArg = arg("--output", null);
  if (!fs.existsSync(txDir) || !fs.statSync(txDir).isDirectory()) throw new Error("--tx-dir must be an existing directory");
  if (!fs.existsSync(caFile) || !fs.statSync(caFile).isFile()) throw new Error("--ca-file must be an existing CSV file");

  const tx = await auditTexas(txDir);
  const ca = await auditCalifornia(caFile);
  const warnings = [];
  const errors = [];

  if (!tx.salesFactNumber.candidateTransactionKeyAuthorized) errors.push("TX_SALES_FACT_NUMBER_NOT_UNIQUE_ENOUGH_FOR_TRANSACTION_KEY");
  if (tx.overlap.fullFamilyCrossFileOverlapDetected) errors.push("TX_CROSS_FILE_OVERLAP_DETECTED");
  if (!ca.grandTotal.authorizedAsAwardedValue) warnings.push("CA_GRAND_TOTAL_NOT_AUTHORIZED_AS_CONTRACT_AWARDED_VALUE");
  warnings.push("TX_PURCHASE_AMOUNT_MUST_REMAIN_REALIZED_SALES_NOT_AWARDED_VALUE");

  const result = {
    ok: errors.length === 0,
    service: "TX_FULL_OVERLAP_CA_AMOUNT_SEMANTICS_AUDIT",
    mode: "READ_ONLY_LOCAL_DATA_AUDIT",
    generatedAt: new Date().toISOString(),
    tx,
    ca,
    warnings,
    errors,
    normalizationAuthorized: errors.length === 0,
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
    tx: {
      filesAudited: tx.filesAudited,
      rowsAudited: tx.rowsAudited,
      salesFactNumber: tx.salesFactNumber,
      overlap: tx.overlap,
      realizedSales: tx.realizedSales,
      dimensions: tx.dimensions
    },
    ca: {
      rowsAudited: ca.rowsAudited,
      purchaseDocument: ca.purchaseDocument,
      grandTotal: ca.grandTotal,
      recommendedKeys: ca.recommendedKeys
    },
    warnings: result.warnings,
    errors: result.errors,
    output: result.output || null
  }, null, 2));
  console.log(`TX_FULL_OVERLAP_CA_AMOUNT_SEMANTICS_AUDIT_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
})().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
