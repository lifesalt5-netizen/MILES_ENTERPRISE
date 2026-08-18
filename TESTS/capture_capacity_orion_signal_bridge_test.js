"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CaptureCapacityOrionSignalBridgeService
} = require("../SERVICES/revenue/CaptureCapacityOrionSignalBridgeService");

class FakeOrion {
  initialize() {
    return {
      ok: true,
      status: "INITIALIZED",
      db: "D:/fake/orion.db"
    };
  }

  query(sql, params = []) {
    if (/PRAGMA table_info\(recompetes\)/i.test(sql)) {
      return [
        "id",
        "company_id",
        "title",
        "recompete_date",
        "source_url",
        "agency",
        "vehicle",
        "contract_number"
      ].map(name => ({ name }));
    }

    if (/PRAGMA table_info\(contractors\)/i.test(sql)) {
      return [
        "id",
        "company",
        "company_norm",
        "uei",
        "website",
        "vehicle"
      ].map(name => ({ name }));
    }

    if (/FROM recompetes r JOIN contractors c/i.test(sql)) {
      assert.match(sql, /recompete_date BETWEEN \? AND \?/i);
      assert.strictEqual(params.length, 5);
      assert.strictEqual(params[0], "2024-08-18");
      assert.strictEqual(params[1], "2028-08-17");
      assert.strictEqual(params[4], 100);

      return [
        {
          id: 1,
          company_id: 100,
          company: "Alpha Federal",
          company_norm: "ALPHA FEDERAL",
          uei: "ALPHAUEI123",
          website: "https://alpha.example",
          title: "Agency cyber support recompete",
          recompete_date: "2026-10-15",
          source_url: "https://sam.gov/opp/alpha-one",
          agency: "Agency A",
          vehicle: "GSA MAS",
          contract_number: "A-001"
        },
        {
          id: 2,
          company_id: 100,
          company: "Alpha Federal",
          company_norm: "ALPHA FEDERAL",
          uei: "ALPHAUEI123",
          website: "https://alpha.example",
          title: "Agency application support recompete",
          recompete_date: "2027-01-20",
          source_url: "https://acquisition.gov/example/alpha-two",
          agency: "Agency B",
          vehicle: "OASIS+",
          contract_number: "A-002"
        },
        {
          id: 3,
          company_id: 200,
          company: "Beta Federal",
          company_norm: "BETA FEDERAL",
          uei: "BETAUEI456",
          website: "https://beta.example",
          title: "Recompete monitoring profile for Beta Federal",
          recompete_date: "2026-11-01",
          source_url: "https://sam.gov/opp/beta-modeled",
          agency: "Agency C",
          vehicle: "CIO-SP3",
          contract_number: "B-001"
        },
        {
          id: 4,
          company_id: 300,
          company: "Gamma Federal",
          company_norm: "GAMMA FEDERAL",
          uei: "GAMMAUEI789",
          website: "https://gamma.example",
          title: "Infrastructure support recompete",
          recompete_date: "2026-12-01",
          source_url: "https://example.com/gamma-recompete",
          agency: "Agency D",
          vehicle: "SEWP",
          contract_number: "G-001"
        },
        {
          id: 5,
          company_id: 400,
          company: "Old Federal",
          company_norm: "OLD FEDERAL",
          uei: "OLDUEI000",
          website: "https://old.example",
          title: "Old recompete",
          recompete_date: "2020-01-01",
          source_url: "https://sam.gov/opp/old",
          agency: "Agency E",
          vehicle: "GSA MAS",
          contract_number: "O-001"
        }
      ];
    }

    throw new Error(`Unexpected query: ${sql}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-orion-bridge-"));
  const service = new CaptureCapacityOrionSignalBridgeService({
    rootDir: root,
    orion: new FakeOrion(),
    now: () => new Date("2026-08-18T19:45:00.000Z"),
    lookbackDays: 730,
    limit: 100
  });

  const report = service.apply();

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.status, "ORION_PUBLIC_SIGNALS_EXPORTED");
  assert.strictEqual(report.readOnly, true);
  assert.strictEqual(report.rowsEvaluated, 5);
  assert.strictEqual(report.verifiedSignalCount, 2);
  assert.strictEqual(report.validationQueueCount, 2);
  assert.strictEqual(report.safety.monitoringProfilesExcluded, true);
  assert.strictEqual(report.safety.authoritativeProcurementSourceRequired, true);
  assert.strictEqual(report.safety.validationOutsideSignalDiscovery, true);
  assert.strictEqual(report.safety.orionDatabaseWrites, false);
  assert.strictEqual(report.safety.outboundWrites, false);

  const verified = readJson(report.signalFile);
  assert.strictEqual(verified.records.length, 2);
  assert.ok(verified.records.every(row => row.company === "Alpha Federal"));
  assert.ok(verified.records.every(row => row.trigger_type === "RECOMPETE_RECORD"));
  assert.ok(verified.records.every(row => /\.gov\//.test(row.source_url)));
  assert.deepStrictEqual(
    verified.records.map(row => row.contract_number).sort(),
    ["A-001", "A-002"]
  );

  const validation = readJson(report.validationFile);
  assert.strictEqual(validation.outboundEligible, false);
  assert.strictEqual(validation.records.length, 2);
  assert.ok(validation.records.some(row => row.reason === "MODELED_MONITORING_PROFILE_REQUIRES_PUBLIC_VALIDATION"));
  assert.ok(validation.records.some(row => row.reason === "AUTHORITATIVE_PUBLIC_PROCUREMENT_SOURCE_REQUIRED"));
  assert.ok(!validation.records.some(row => row.company === "Old Federal"));

  const signalRoot = `${path.resolve(service.signalDir)}${path.sep}`;
  assert.ok(!path.resolve(report.validationFile).startsWith(signalRoot));
  assert.ok(!path.resolve(report.artifact).startsWith(signalRoot));
  assert.ok(fs.existsSync(report.artifact));

  fs.rmSync(root, { recursive: true, force: true });

  console.log("PASS capture_capacity_orion_signal_bridge_test");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
