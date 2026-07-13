"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class EnterpriseScheduler {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.jobs = new Map();
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS scheduler_runs (
        id TEXT PRIMARY KEY,
        jobName TEXT,
        status TEXT,
        startedAt TEXT,
        finishedAt TEXT,
        durationMs INTEGER,
        error TEXT,
        payload TEXT
      )
    `).run();
  }

  register(jobName, handler) {
    if (!jobName) throw new Error("Missing scheduler job name.");
    if (typeof handler !== "function") throw new Error("Scheduler handler must be a function.");

    this.jobs.set(jobName, handler);
  }

  async runJob(jobName) {
    const handler = this.jobs.get(jobName);
    if (!handler) throw new Error(`Scheduler job not registered: ${jobName}`);

    const runId = this.store.id("SCHEDRUN");
    const startedAt = this.now();
    const start = Date.now();

    this.db.prepare(`
      INSERT INTO scheduler_runs
      (id, jobName, status, startedAt, finishedAt, durationMs, error, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      jobName,
      "RUNNING",
      startedAt,
      null,
      null,
      null,
      JSON.stringify({})
    );

    try {
      const result = await handler();

      const finishedAt = this.now();
      const durationMs = Date.now() - start;

      this.db.prepare(`
        UPDATE scheduler_runs
        SET status=?, finishedAt=?, durationMs=?, payload=?
        WHERE id=?
      `).run(
        "SUCCESS",
        finishedAt,
        durationMs,
        JSON.stringify(result || {}),
        runId
      );

      this.store.insertEvent("SCHEDULER_JOB_SUCCESS", "Scheduler", {
        runId,
        jobName,
        durationMs,
        result
      });

      return {
        runId,
        jobName,
        status: "SUCCESS",
        durationMs,
        result
      };
    } catch (error) {
      const finishedAt = this.now();
      const durationMs = Date.now() - start;

      this.db.prepare(`
        UPDATE scheduler_runs
        SET status=?, finishedAt=?, durationMs=?, error=?
        WHERE id=?
      `).run(
        "FAILED",
        finishedAt,
        durationMs,
        error.message,
        runId
      );

      this.store.insertEvent("SCHEDULER_JOB_FAILED", "Scheduler", {
        runId,
        jobName,
        durationMs,
        error: error.message
      });

      return {
        runId,
        jobName,
        status: "FAILED",
        durationMs,
        error: error.message
      };
    }
  }

  async runAll() {
    const results = [];

    for (const jobName of this.jobs.keys()) {
      results.push(await this.runJob(jobName));
    }

    return results;
  }

  recentRuns(limit = 20) {
    return this.db.prepare(`
      SELECT *
      FROM scheduler_runs
      ORDER BY startedAt DESC
      LIMIT ?
    `).all(limit);
  }
}

module.exports = EnterpriseScheduler;
