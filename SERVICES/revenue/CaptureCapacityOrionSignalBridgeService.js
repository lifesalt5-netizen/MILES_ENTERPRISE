"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_LIMIT = 5000;
const DEFAULT_LOOKBACK_DAYS = 730;

function clean(value) {
  return String(value ?? "").trim();
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return "";
}

function parseDate(value) {
  const raw = clean(value);
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const parsed = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function compactDate(ms) {
  return isoDate(ms).replace(/-/g, "");
}

function normalizeUrl(value) {
  const raw = clean(value);
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function isAuthoritativeProcurementUrl(value) {
  const raw = normalizeUrl(value);
  if (!raw) return false;

  try {
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "sam.gov" ||
      hostname.endsWith(".sam.gov") ||
      hostname === "usaspending.gov" ||
      hostname.endsWith(".usaspending.gov") ||
      hostname.endsWith(".gov") ||
      hostname.endsWith(".mil");
  } catch {
    return false;
  }
}

function externalSource(row = {}) {
  const candidates = [
    row.source_url,
    row.notice_url,
    row.sam_url,
    row.award_url,
    row.contract_url,
    row.public_url,
    row.url,
    row.link,
    row.source
  ];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (url && isAuthoritativeProcurementUrl(url)) return url;
  }

  return "";
}

function companyIdentity(row = {}) {
  return {
    company: clean(first(row, ["company", "company_name", "company_norm", "contractor"])),
    uei: clean(first(row, ["uei", "recipient_uei", "awardee_uei"])),
    website: clean(first(row, ["website", "company_website", "domain"]))
  };
}

function isMonitoringProfile(row = {}) {
  const title = clean(first(row, ["title", "name", "contract_name", "description"]));
  return /^recompete monitoring profile for /i.test(title) ||
    /modeled monitoring|monitoring profile/i.test(clean(row.signal_type || row.signalType));
}

function evidenceText(row = {}) {
  return clean(first(row, [
    "title",
    "contract_name",
    "description",
    "summary",
    "notice_title",
    "award_description",
    "detail"
  ]));
}

function eventDate(row = {}) {
  return clean(first(row, [
    "recompete_date",
    "expiration_date",
    "end_date",
    "period_of_performance_end_date",
    "anticipated_date",
    "date"
  ]));
}

function withinWindow(value, nowMs, lookbackDays) {
  const ts = parseDate(value);
  if (ts === null) return true;
  const windowMs = lookbackDays * 86400000;
  const age = nowMs - ts;
  return age >= -windowMs && age <= windowMs;
}

class CaptureCapacityOrionSignalBridgeService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.orion = options.orion || null;
    this.now = options.now || (() => new Date());
    this.limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT), 25000));
    this.lookbackDays = Math.max(1, Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS));
    this.baseDir = options.baseDir || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity"
    );
    this.signalDir = options.signalDir || path.join(this.baseDir, "signals");
    this.validationDir = options.validationDir || path.join(this.baseDir, "validation");
    this.signalFile = options.signalFile || path.join(
      this.signalDir,
      "capture_capacity_orion_verified_signals.json"
    );
    this.validationFile = options.validationFile || path.join(
      this.validationDir,
      "orion_recompete_validation_queue.json"
    );
    this.reportFile = options.reportFile || path.join(
      this.baseDir,
      "orion_signal_bridge_latest.json"
    );
  }

  getOrion() {
    if (this.orion) return this.orion;
    this.orion = require("../../CONNECTORS/ORION/connector");
    return this.orion;
  }

  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, file);
    return file;
  }

  schema(orion, tableName) {
    try {
      return orion.query(`PRAGMA table_info(${tableName})`, []);
    } catch {
      return [];
    }
  }

  loadRows(orion) {
    const recompeteSchema = this.schema(orion, "recompetes");
    const contractorSchema = this.schema(orion, "contractors");
    const recompeteColumns = new Set(recompeteSchema.map(row => clean(row.name)));
    const contractorColumns = new Set(contractorSchema.map(row => clean(row.name)));

    if (!recompeteColumns.has("company_id") || !contractorColumns.has("id")) {
      return {
        ok: false,
        status: "ORION_RECOMPETE_JOIN_KEYS_MISSING",
        rows: [],
        schema: {
          recompetes: [...recompeteColumns],
          contractors: [...contractorColumns]
        }
      };
    }

    const contractorSelect = [
      contractorColumns.has("company") ? "c.company AS company" : null,
      contractorColumns.has("company_norm") ? "c.company_norm AS company_norm" : null,
      contractorColumns.has("uei") ? "c.uei AS uei" : null,
      contractorColumns.has("website") ? "c.website AS website" : null,
      contractorColumns.has("vehicle") ? "c.vehicle AS contractor_vehicle" : null
    ].filter(Boolean);

    const select = ["r.*", ...contractorSelect].join(", ");
    const params = [];
    let where = "";
    let orderBy = "";

    if (recompeteColumns.has("recompete_date")) {
      const nowMs = this.now().getTime();
      const windowMs = this.lookbackDays * 86400000;
      const startMs = nowMs - windowMs;
      const endMs = nowMs + windowMs;

      where = `WHERE (
        (r.recompete_date BETWEEN ? AND ?) OR
        (r.recompete_date BETWEEN ? AND ?)
      )`;
      params.push(
        isoDate(startMs),
        isoDate(endMs),
        compactDate(startMs),
        compactDate(endMs)
      );
      orderBy = "ORDER BY r.recompete_date ASC";
    }

    try {
      const rows = orion.query(
        `SELECT ${select} FROM recompetes r JOIN contractors c ON c.id = r.company_id ${where} ${orderBy} LIMIT ?`,
        [...params, this.limit]
      );

      return {
        ok: true,
        status: "ORION_RECOMPETES_LOADED",
        rows: Array.isArray(rows) ? rows : [],
        schema: {
          recompetes: [...recompeteColumns],
          contractors: [...contractorColumns]
        }
      };
    } catch (error) {
      return {
        ok: false,
        status: "ORION_RECOMPETE_QUERY_FAILED",
        error: error.message,
        rows: [],
        schema: {
          recompetes: [...recompeteColumns],
          contractors: [...contractorColumns]
        }
      };
    }
  }

  normalizeVerifiedSignal(row) {
    const identity = companyIdentity(row);
    const source = externalSource(row);
    const date = eventDate(row);
    const evidence = evidenceText(row) ||
      `Upcoming recompete signal identified for ${identity.company || "contractor"}.`;

    return {
      company: identity.company,
      uei: identity.uei,
      website: identity.website,
      trigger_type: "RECOMPETE_RECORD",
      evidence,
      source_url: source,
      event_date: date,
      recompete_date: clean(row.recompete_date || date),
      agency: clean(first(row, ["agency", "agency_name", "awarding_agency", "funding_agency", "customer"])),
      vehicle: clean(first(row, ["vehicle", "vehicle_name", "contract_vehicle", "gwac", "idiq", "schedule", "contractor_vehicle"])),
      contract_number: clean(first(row, ["contract_number", "award_id", "piid", "contract_id"])),
      source_system: "ORION_RECOMPETES_AUTHORITATIVE_SOURCE_VERIFIED",
      orion_row_id: row.id ?? null
    };
  }

  normalizeValidationCandidate(row, reason) {
    const identity = companyIdentity(row);
    return {
      company: identity.company,
      uei: identity.uei,
      website: identity.website,
      title: evidenceText(row),
      recompete_date: eventDate(row),
      agency: clean(first(row, ["agency", "agency_name", "awarding_agency", "funding_agency", "customer"])),
      vehicle: clean(first(row, ["vehicle", "vehicle_name", "contract_vehicle", "gwac", "idiq", "schedule", "contractor_vehicle"])),
      contract_number: clean(first(row, ["contract_number", "award_id", "piid", "contract_id"])),
      reason,
      source_system: "ORION_RECOMPETES_VALIDATION_QUEUE",
      orion_row_id: row.id ?? null
    };
  }

  unavailableReport(error) {
    const report = {
      ok: false,
      status: "ORION_UNAVAILABLE",
      error: clean(error?.message || error || "ORION initialization failed."),
      verifiedSignalCount: 0,
      validationQueueCount: 0,
      signalFile: this.signalFile,
      validationFile: this.validationFile,
      safety: {
        monitoringProfilesExcluded: true,
        authoritativeProcurementSourceRequired: true,
        validationOutsideSignalDiscovery: true,
        orionDatabaseWrites: false,
        outboundWrites: false
      },
      generatedAt: this.now().toISOString()
    };
    report.artifact = this.writeJson(this.reportFile, report);
    return report;
  }

  apply() {
    let orion;
    let init;

    try {
      orion = this.getOrion();
      init = orion.initialize();
    } catch (error) {
      return this.unavailableReport(error);
    }

    if (!init?.ok) {
      return this.unavailableReport(init?.message || "ORION initialization failed.");
    }

    const loaded = this.loadRows(orion);
    const verifiedSignals = [];
    const validationQueue = [];
    const nowMs = this.now().getTime();

    if (loaded.ok) {
      for (const row of loaded.rows) {
        const identity = companyIdentity(row);
        const date = eventDate(row);

        if (!identity.company && !identity.uei) {
          validationQueue.push(this.normalizeValidationCandidate(row, "COMPANY_IDENTITY_MISSING"));
          continue;
        }

        if (!withinWindow(date, nowMs, this.lookbackDays)) {
          continue;
        }

        if (isMonitoringProfile(row)) {
          validationQueue.push(this.normalizeValidationCandidate(row, "MODELED_MONITORING_PROFILE_REQUIRES_PUBLIC_VALIDATION"));
          continue;
        }

        if (!externalSource(row)) {
          validationQueue.push(this.normalizeValidationCandidate(row, "AUTHORITATIVE_PUBLIC_PROCUREMENT_SOURCE_REQUIRED"));
          continue;
        }

        verifiedSignals.push(this.normalizeVerifiedSignal(row));
      }
    }

    const verifiedPayload = {
      ok: loaded.ok,
      source: "CaptureCapacityOrionSignalBridgeService",
      generatedAt: this.now().toISOString(),
      records: verifiedSignals
    };

    const validationPayload = {
      ok: loaded.ok,
      source: "CaptureCapacityOrionSignalBridgeService",
      outboundEligible: false,
      generatedAt: this.now().toISOString(),
      records: validationQueue
    };

    this.writeJson(this.signalFile, verifiedPayload);
    this.writeJson(this.validationFile, validationPayload);

    const report = {
      ok: loaded.ok,
      status: loaded.ok
        ? verifiedSignals.length > 0
          ? "ORION_PUBLIC_SIGNALS_EXPORTED"
          : "ORION_SIGNALS_REQUIRE_PUBLIC_VALIDATION"
        : loaded.status,
      readOnly: true,
      rowsEvaluated: loaded.rows.length,
      verifiedSignalCount: verifiedSignals.length,
      validationQueueCount: validationQueue.length,
      signalFile: this.signalFile,
      validationFile: this.validationFile,
      schema: loaded.schema,
      error: loaded.error || null,
      safety: {
        monitoringProfilesExcluded: true,
        authoritativeProcurementSourceRequired: true,
        validationOutsideSignalDiscovery: true,
        orionDatabaseWrites: false,
        outboundWrites: false
      },
      generatedAt: this.now().toISOString()
    };

    report.artifact = this.writeJson(this.reportFile, report);
    return report;
  }
}

module.exports = new CaptureCapacityOrionSignalBridgeService();
module.exports.CaptureCapacityOrionSignalBridgeService = CaptureCapacityOrionSignalBridgeService;
module.exports.helpers = {
  clean,
  first,
  parseDate,
  isoDate,
  compactDate,
  normalizeUrl,
  isAuthoritativeProcurementUrl,
  externalSource,
  companyIdentity,
  isMonitoringProfile,
  evidenceText,
  eventDate,
  withinWindow
};
