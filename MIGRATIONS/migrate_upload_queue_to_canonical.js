"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.cwd(), "DATA", "enterprise_db", "Enterprise.db");
const db = new Database(dbPath);

function tableExists(name) {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
}

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function renameIfExists(oldName, newName) {
  if (tableExists(oldName) && !tableExists(newName)) {
    db.prepare(`ALTER TABLE ${oldName} RENAME TO ${newName}`).run();
    console.log(`Renamed ${oldName} -> ${newName}`);
  }
}

const migrate = db.transaction(() => {
  renameIfExists("marketing_upload_queue", "marketing_upload_queue_legacy");
  renameIfExists("marketing_upload_queue_runs", "marketing_upload_queue_runs_legacy");

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketing_upload_queue (
      id TEXT PRIMARY KEY,
      segmentId TEXT,
      segmentName TEXT,
      campaignId TEXT,
      campaignName TEXT,
      domain TEXT,
      requestedUploadCount INTEGER,
      approvedUploadCount INTEGER,
      status TEXT,
      priority INTEGER,
      requiresKevin INTEGER,
      approvalId TEXT,
      reason TEXT,
      payload TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketing_upload_queue_runs (
      id TEXT PRIMARY KEY,
      queuedItems INTEGER,
      skippedItems INTEGER,
      payload TEXT,
      createdAt TEXT
    )
  `).run();

  if (tableExists("marketing_upload_queue_legacy")) {
    const existing = db.prepare("SELECT COUNT(*) AS n FROM marketing_upload_queue").get().n;

    if (existing === 0) {
      db.prepare(`
        INSERT INTO marketing_upload_queue (
          id,
          segmentId,
          segmentName,
          campaignId,
          campaignName,
          domain,
          requestedUploadCount,
          approvedUploadCount,
          status,
          priority,
          requiresKevin,
          approvalId,
          reason,
          payload,
          createdAt,
          updatedAt
        )
        SELECT
          id,
          segment_id,
          segment_name,
          campaign_id,
          campaign_name,
          domain,
          requested_upload_count,
          approved_upload_count,
          status,
          priority,
          requires_approval,
          approval_id,
          reason,
          json_object(
            'sourceEngine', source_engine,
            'legacyMigrated', 1
          ),
          created_at,
          updated_at
        FROM marketing_upload_queue_legacy
      `).run();
    }
  }

  if (tableExists("marketing_upload_queue_runs_legacy")) {
    const existing = db.prepare("SELECT COUNT(*) AS n FROM marketing_upload_queue_runs").get().n;

    if (existing === 0) {
      db.prepare(`
        INSERT INTO marketing_upload_queue_runs (
          id,
          queuedItems,
          skippedItems,
          payload,
          createdAt
        )
        SELECT
          id,
          queued_items,
          skipped_items,
          json_object(
            'notes', notes,
            'legacyMigrated', 1
          ),
          created_at
        FROM marketing_upload_queue_runs_legacy
      `).run();
    }
  }
});

migrate();

console.log("Migration complete.");
console.log("marketing_upload_queue columns:", columns("marketing_upload_queue"));
console.log("marketing_upload_queue_runs columns:", columns("marketing_upload_queue_runs"));
console.log("Legacy tables preserved:");
console.log("marketing_upload_queue_legacy:", tableExists("marketing_upload_queue_legacy"));
console.log("marketing_upload_queue_runs_legacy:", tableExists("marketing_upload_queue_runs_legacy"));
