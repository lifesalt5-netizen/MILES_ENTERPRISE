"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class EnterpriseJobRegistry {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS enterprise_jobs (
        id TEXT PRIMARY KEY,
        department TEXT,
        jobName TEXT UNIQUE,
        status TEXT,
        priority INTEGER,
        schedule TEXT,
        retryPolicy TEXT,
        dependencies TEXT,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )
    `).run();
  }

  register(job = {}) {
    const item = {
      id: job.id || this.store.id("JOB"),
      department: job.department || "General",
      jobName: job.jobName,
      status: job.status || "ENABLED",
      priority: Number(job.priority || 50),
      schedule: job.schedule || "MANUAL",
      retryPolicy: job.retryPolicy || { retries: 0 },
      dependencies: job.dependencies || [],
      payload: job.payload || {},
      createdAt: job.createdAt || this.now(),
      updatedAt: this.now()
    };

    if (!item.jobName) throw new Error("Missing jobName.");

    this.db.prepare(`
      INSERT OR REPLACE INTO enterprise_jobs
      (id, department, jobName, status, priority, schedule, retryPolicy, dependencies, payload, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.department,
      item.jobName,
      item.status,
      item.priority,
      item.schedule,
      JSON.stringify(item.retryPolicy),
      JSON.stringify(item.dependencies),
      JSON.stringify(item.payload),
      item.createdAt,
      item.updatedAt
    );

    this.store.insertEvent("ENTERPRISE_JOB_REGISTERED", "Scheduler", item);
    return item;
  }

  list(status = null) {
    const rows = status
      ? this.db.prepare("SELECT * FROM enterprise_jobs WHERE status=? ORDER BY priority ASC").all(status)
      : this.db.prepare("SELECT * FROM enterprise_jobs ORDER BY priority ASC").all();

    return rows.map(row => ({
      ...row,
      retryPolicy: JSON.parse(row.retryPolicy || "{}"),
      dependencies: JSON.parse(row.dependencies || "[]"),
      payload: JSON.parse(row.payload || "{}")
    }));
  }

  enable(jobName) {
    return this.setStatus(jobName, "ENABLED");
  }

  disable(jobName) {
    return this.setStatus(jobName, "DISABLED");
  }

  setStatus(jobName, status) {
    this.db.prepare(`
      UPDATE enterprise_jobs
      SET status=?, updatedAt=?
      WHERE jobName=?
    `).run(status, this.now(), jobName);

    this.store.insertEvent("ENTERPRISE_JOB_STATUS_CHANGED", "Scheduler", {
      jobName,
      status
    });

    return this.get(jobName);
  }

  get(jobName) {
    const row = this.db.prepare("SELECT * FROM enterprise_jobs WHERE jobName=?").get(jobName);
    if (!row) return null;

    return {
      ...row,
      retryPolicy: JSON.parse(row.retryPolicy || "{}"),
      dependencies: JSON.parse(row.dependencies || "[]"),
      payload: JSON.parse(row.payload || "{}")
    };
  }
}

module.exports = EnterpriseJobRegistry;
