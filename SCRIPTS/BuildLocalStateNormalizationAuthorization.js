"use strict";

const fs = require("fs");
const path = require("path");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function mustExist(label, file) {
  if (!file || !fs.existsSync(file)) throw new Error(`${label} must point to an existing JSON file`);
}

const txAuditPath = path.resolve(arg("--tx-audit"));
const caTxAuditPath = path.resolve(arg("--ca-tx-audit"));
const outputArg = arg("--output", null);

mustExist("--tx-audit", txAuditPath);
mustExist("--ca-tx-audit", caTxAuditPath);

const txAudit = loadJson(txAuditPath);
const caTxAudit = loadJson(caTxAuditPath);

const blockers = [];
const warnings = [];

if (!txAudit.ok) blockers.push("TX_COMPOSITE_TRANSACTION_AUDIT_MUST_PASS");
if (!txAudit.recommendedTransactionLineKey?.authorizedForDeduplication) blockers.push("TX_TRANSACTION_DEDUPLICATION_KEY_NOT_AUTHORIZED");
if (!txAudit.realizedSales?.authorizedAsRealizedSalesAfterExactDuplicateRemoval) blockers.push("TX_REALIZED_SALES_NOT_AUTHORIZED_AFTER_DEDUPLICATION");
if ((txAudit.salesFact?.conflictingDuplicateRows || 0) !== 0) blockers.push("TX_CONFLICTING_DUPLICATE_ROWS_PRESENT");
if ((txAudit.salesFact?.crossFileConflicts || 0) !== 0) blockers.push("TX_CROSS_FILE_CONFLICTS_PRESENT");

const ca = caTxAudit.ca || {};
const caKey = ca.recommendedKeys?.awardCountCandidate || [];
if (JSON.stringify(caKey) !== JSON.stringify(["Supplier ID", "Purchase Document #"])) {
  blockers.push("CA_PURCHASE_DOCUMENT_IDENTITY_KEY_NOT_CONFIRMED");
}
if (!Number.isFinite(Number(ca.purchaseDocument?.supplierPurchaseDocDistinct))) {
  blockers.push("CA_DISTINCT_SUPPLIER_PURCHASE_DOCUMENT_COUNT_MISSING");
}
if (!caTxAudit.tx || !Number.isFinite(Number(txAudit.realizedSales?.dedupedTransactionLineSum))) {
  blockers.push("TX_DEDUPED_REALIZED_SALES_TOTAL_MISSING");
}

if (!ca.grandTotal?.authorizedAsAwardedValue) {
  warnings.push("CA_GRAND_TOTAL_MUST_NOT_BE_LABELED_CONTRACT_AWARDED_VALUE");
}
if (!ca.grandTotal?.authorizedAsPurchaseDocumentValue) {
  warnings.push("CA_GRAND_TOTAL_PURCHASE_DOCUMENT_VALUE_REQUIRES_FAIL_CLOSED_HANDLING_FOR_INVALID_OR_CONFLICTING_ROWS");
}
warnings.push("TX_PURCHASE_AMOUNT_IS_REALIZED_SALES_NOT_AWARDED_VALUE");
warnings.push("TX_DISTINCT_CONTRACT_NUMBER_IS_CONTRACT_RELATIONSHIP_COUNT_NOT_TRANSACTION_COUNT");
warnings.push("CA_DISTINCT_SUPPLIER_PURCHASE_DOCUMENT_IS_PURCHASE_DOCUMENT_COUNT_NOT_AUTOMATICALLY_CONTRACT_AWARD_COUNT");

const authorized = blockers.length === 0;

const result = {
  ok: authorized,
  service: "LOCAL_STATE_NORMALIZATION_AUTHORIZATION",
  mode: "PLAN_ONLY_NO_ORION_WRITES",
  generatedAt: new Date().toISOString(),
  sourceAudits: {
    txCompositeAudit: txAuditPath,
    caTxFullAudit: caTxAuditPath
  },
  texas: {
    status: authorized ? "NORMALIZATION_AUTHORIZED_TO_STAGING" : "BLOCKED",
    source: "Texas DIR Sales",
    semanticRules: {
      realizedSalesField: "purchase_amount",
      realizedSalesLabel: "SLED_REALIZED_SALES",
      awardedValueAuthorized: false,
      negativeAmounts: "PRESERVE_AS_ADJUSTMENTS",
      primaryGroupingField: "sales_fact_number",
      exactDuplicateRule: "REMOVE_EXACT_DUPLICATE_TRANSACTION_LINES_ONLY",
      blankSalesFactFallback: "USE_AUTHORIZED_LINE_FINGERPRINT_WITHOUT_SALES_FACT_NUMBER",
      transactionLineFingerprintFields: txAudit.recommendedTransactionLineKey?.lineFingerprintFields || [],
      contractRelationshipKey: "contract_number",
      contractRelationshipCountIsAwardCount: false
    },
    evidence: {
      rowsAudited: txAudit.rowsAudited,
      exactDuplicateRows: txAudit.salesFact?.exactDuplicateRows,
      conflictingDuplicateRows: txAudit.salesFact?.conflictingDuplicateRows,
      crossFileExactDuplicates: txAudit.salesFact?.crossFileExactDuplicates,
      crossFileConflicts: txAudit.salesFact?.crossFileConflicts,
      rawSales: txAudit.realizedSales?.rawRowSum,
      dedupedRealizedSales: txAudit.realizedSales?.dedupedTransactionLineSum,
      rowsRemovedAsExactDuplicates: txAudit.realizedSales?.rowsRemovedAsExactDuplicates
    }
  },
  california: {
    status: authorized ? "NORMALIZATION_AUTHORIZED_TO_STAGING_WITH_VALUE_RESTRICTIONS" : "BLOCKED",
    source: "California SCPRS",
    semanticRules: {
      vendorIdentityKey: "Supplier ID",
      purchaseDocumentKey: ["Supplier ID", "Purchase Document #"],
      latestVersionControl: "Version",
      lpaContext: "LPA Contract ID",
      purchaseDocumentCountLabel: "SLED_PURCHASE_DOCUMENT_COUNT",
      purchaseDocumentCountIsAutomaticContractAwardCount: false,
      grandTotalLabel: "SLED_PURCHASE_DOCUMENT_VALUE_CANDIDATE",
      grandTotalAuthorizedAsContractAwardedValue: false,
      grandTotalAggregationRule: "FAIL_CLOSED_FOR_INVALID_OR_CONFLICTING_GROUPS; DO_NOT_PROMOTE_TO_CONTRACT_AWARDED_VALUE"
    },
    evidence: {
      rowsAudited: ca.rowsAudited,
      distinctSupplierPurchaseDocuments: ca.purchaseDocument?.supplierPurchaseDocDistinct,
      distinctSupplierLpaPurchaseDocuments: ca.purchaseDocument?.supplierLpaPurchaseDocDistinct,
      versionedDuplicateGroups: ca.purchaseDocument?.versionedDuplicateGroups,
      grandTotalInvalidRows: ca.grandTotal?.invalidRows,
      grandTotalConflictingGroups: ca.grandTotal?.conflictingAmountGroups,
      rawGrandTotal: ca.grandTotal?.rawRowSum,
      latestVersionSupplierPurchaseDocTotal: ca.grandTotal?.dedupedBySupplierPurchaseDocumentLatestVersionSum
    }
  },
  downstreamRules: {
    stagingOnly: true,
    orionWritesAuthorized: false,
    federalReconciliationRequiredBeforeMarketClassification: true,
    stateVendorRegistrationIsNotAwardEvidence: true,
    preserveFederalPrimeAndSubcontractHistorySeparately: true,
    preserveSledAwardedValueAndRealizedRevenueSeparately: true
  },
  blockers,
  warnings
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
  texas: {
    status: result.texas.status,
    dedupedRealizedSales: result.texas.evidence.dedupedRealizedSales,
    exactDuplicateRows: result.texas.evidence.exactDuplicateRows,
    conflictingDuplicateRows: result.texas.evidence.conflictingDuplicateRows
  },
  california: {
    status: result.california.status,
    distinctSupplierPurchaseDocuments: result.california.evidence.distinctSupplierPurchaseDocuments,
    grandTotalAuthorizedAsContractAwardedValue: result.california.semanticRules.grandTotalAuthorizedAsContractAwardedValue,
    grandTotalConflictingGroups: result.california.evidence.grandTotalConflictingGroups
  },
  blockers: result.blockers,
  warnings: result.warnings,
  output: result.output || null
}, null, 2));
console.log(`LOCAL_STATE_NORMALIZATION_AUTHORIZATION_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
