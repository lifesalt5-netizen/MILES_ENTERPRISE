'use strict';

const fs = require('fs');
const path = require('path');
const MasterContractorTaxonomyEngine = require('./MasterContractorTaxonomyEngine');

function clean(value) { return value == null ? '' : String(value).trim(); }
function truthy(value) { return Number(value || 0) === 1 || value === true; }

class CanonicalContractorTaxonomyOverlayService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.Database = options.Database || null;
    this.engine = options.engine || new MasterContractorTaxonomyEngine({ rootDir: this.rootDir });
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_universe');
    this.reportPath = path.join(this.outputDir, 'latest_canonical_contractor_taxonomy_overlay.json');
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  run(options = {}) {
    const canonical = options.canonical || null;
    const dbPath = canonical?.artifacts?.database;
    if (!canonical?.ok || !dbPath || !fs.existsSync(dbPath)) throw new Error('CANONICAL_AWARDED_MASTER_REQUIRED');
    const Database = this.loadDatabase();
    const db = new Database(dbPath);
    const generatedAt = new Date().toISOString();
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contractor_taxonomy (
          uei TEXT PRIMARY KEY,
          award_role TEXT NOT NULL,
          award_recency TEXT NOT NULL,
          government_sales_band TEXT NOT NULL,
          commercial_disposition TEXT NOT NULL,
          next_action TEXT NOT NULL,
          primary_outbound_segment TEXT NOT NULL,
          all_segment_tags_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(uei) REFERENCES canonical_contractor_master(uei)
        );
        DELETE FROM contractor_taxonomy;
        CREATE INDEX IF NOT EXISTS idx_taxonomy_role ON contractor_taxonomy(award_role);
        CREATE INDEX IF NOT EXISTS idx_taxonomy_sales_band ON contractor_taxonomy(government_sales_band);
        CREATE INDEX IF NOT EXISTS idx_taxonomy_disposition ON contractor_taxonomy(commercial_disposition);
      `);
      const insert = db.prepare(`INSERT INTO contractor_taxonomy
        (uei,award_role,award_recency,government_sales_band,commercial_disposition,next_action,primary_outbound_segment,all_segment_tags_json,updated_at)
        VALUES (@uei,@award_role,@award_recency,@government_sales_band,@commercial_disposition,@next_action,@primary_outbound_segment,@all_segment_tags_json,@updated_at)`);
      const rows = db.prepare(`SELECT uei, company, primary_segment, current_sam_qualified, prime_obligations, prime_award_count, prime_latest_action_date,
        subaward_obligations, subaward_row_count, total_awarded_obligations, verified_current_contact, contact_email,
        suppressed_contact_rows, account_do_not_prospect, existing_client FROM canonical_contractor_master`).all();
      const counts = { PRIME: 0, SUB: 0, BOTH: 0, UNKNOWN: 0 };
      const bands = {};
      const dispositions = {};
      const tx = db.transaction(items => {
        for (const row of items) {
          const latestDate = clean(row.prime_latest_action_date);
          const latestYear = latestDate ? Number(latestDate.slice(0, 4)) : 2026;
          const classified = this.engine.classify({
            totalGovernmentSales: row.total_awarded_obligations,
            primeAwardCount: row.prime_award_count,
            subawardCount: row.subaward_row_count,
            fy2026PrimeAwardCount: row.prime_award_count,
            fy2026SubawardCount: row.subaward_row_count,
            mostRecentAwardFiscalYear: latestYear,
            companyKnown: Boolean(clean(row.company)),
            verifiedEmail: truthy(row.verified_current_contact),
            unsuppressedEmail: Boolean(clean(row.contact_email)),
            suppressedContact: Number(row.suppressed_contact_rows || 0) > 0,
            currentSamQualified: truthy(row.current_sam_qualified),
            accountDoNotProspect: truthy(row.account_do_not_prospect),
            existingClient: truthy(row.existing_client),
            existingTaxonomyTags: [`primary_outbound_segment:${clean(row.primary_segment) || 'UNKNOWN'}`]
          });
          const primary = clean(row.primary_segment) || classified.primaryFallbackSegment;
          insert.run({
            uei: row.uei,
            award_role: classified.awardRole,
            award_recency: classified.awardRecency,
            government_sales_band: classified.governmentSalesBand,
            commercial_disposition: classified.commercialDisposition,
            next_action: classified.nextAction,
            primary_outbound_segment: primary,
            all_segment_tags_json: JSON.stringify(classified.allSegmentTags),
            updated_at: generatedAt
          });
          counts[classified.awardRole] = Number(counts[classified.awardRole] || 0) + 1;
          bands[classified.governmentSalesBand] = Number(bands[classified.governmentSalesBand] || 0) + 1;
          dispositions[classified.commercialDisposition] = Number(dispositions[classified.commercialDisposition] || 0) + 1;
        }
      });
      tx(rows);
      const taxonomyRows = Number(db.prepare('SELECT COUNT(*) AS n FROM contractor_taxonomy').get().n || 0);
      const canonicalRows = Number(db.prepare('SELECT COUNT(*) AS n FROM canonical_contractor_master').get().n || 0);
      const missing = Number(db.prepare('SELECT COUNT(*) AS n FROM canonical_contractor_master c LEFT JOIN contractor_taxonomy t ON t.uei=c.uei WHERE t.uei IS NULL').get().n || 0);
      const integrity = db.pragma('integrity_check', { simple: true });
      const acceptance = {
        taxonomyRowsEqualCanonicalRows: taxonomyRows === canonicalRows,
        zeroCanonicalAccountsMissingTaxonomy: missing === 0,
        sqliteIntegrityOk: integrity === 'ok'
      };
      if (!Object.values(acceptance).every(Boolean)) throw new Error(`CANONICAL_TAXONOMY_ACCEPTANCE_FAILED:${JSON.stringify(acceptance)}`);
      const report = {
        ok: true,
        status: 'MASTER_CONTRACTOR_TAXONOMY_OVERLAY_GREEN',
        generatedAt,
        counts: { canonicalRows, taxonomyRows, awardRoles: counts, governmentSalesBands: bands, commercialDispositions: dispositions },
        acceptance,
        artifacts: { database: dbPath, report: this.reportPath },
        safety: {
          canonicalStagingDatabaseOnly: true,
          productionOrionModified: false,
          currentOutboundMasterModified: false,
          providerMutation: false,
          campaignMutation: false,
          emailSent: false,
          suppressionOverridden: false
        }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
      return report;
    } finally { db.close(); }
  }
}

module.exports = CanonicalContractorTaxonomyOverlayService;
