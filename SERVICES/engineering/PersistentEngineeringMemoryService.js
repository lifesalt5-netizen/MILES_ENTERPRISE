"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .toUpperCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function eventHash(event) {
  const body = { ...event };
  delete body.eventHash;
  return sha256(Buffer.from(JSON.stringify(stable(body)), "utf8"));
}

class PersistentEngineeringMemoryService {
  constructor(options = {}) {
    this.service = "PERSISTENT_ENGINEERING_MEMORY";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.memoryRoot = options.memoryRoot || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "engineering",
      "memory"
    );
    this.ledgerPath = options.ledgerPath || path.join(
      this.memoryRoot,
      "engineering_events.jsonl"
    );
    this.snapshotPath = options.snapshotPath || path.join(
      this.memoryRoot,
      "engineering_memory_snapshot.json"
    );
    this.lockPath = `${this.ledgerPath}.lock`;
    this.now = options.now || (() => Date.now());
    this.maxSummaryLength = Number(options.maxSummaryLength || 2000);
  }

  normalizeInput(input = {}) {
    const eventType = String(input.eventType || "").toUpperCase();
    const allowedTypes = new Set([
      "GATE_LOCKED",
      "MILESTONE_LOCKED",
      "PR_MERGED",
      "VALIDATION_PASSED",
      "ENGINEERING_DECISION"
    ]);
    const gate = String(input.gate || "").trim();
    const status = String(input.status || "").toUpperCase();
    const summary = String(input.summary || "").trim();
    if (
      !allowedTypes.has(eventType) ||
      gate.length < 3 ||
      gate.length > 160 ||
      !["PASS", "LOCKED", "MERGED", "RECORDED"].includes(status) ||
      summary.length < 3 ||
      summary.length > this.maxSummaryLength
    ) {
      throw new Error("ENGINEERING_MEMORY_EVENT_INVALID");
    }
    const repositoryFingerprint = input.repositoryFingerprint || null;
    const mergeSha = input.mergeSha || null;
    if (
      repositoryFingerprint !== null &&
      !/^[A-F0-9]{64}$/.test(repositoryFingerprint)
    ) {
      throw new Error("ENGINEERING_MEMORY_REPOSITORY_FINGERPRINT_INVALID");
    }
    if (mergeSha !== null && !/^[a-f0-9]{40}$/.test(mergeSha)) {
      throw new Error("ENGINEERING_MEMORY_MERGE_SHA_INVALID");
    }
    const pullRequest = input.pullRequest === null || input.pullRequest === undefined
      ? null
      : Number(input.pullRequest);
    if (pullRequest !== null && (!Number.isInteger(pullRequest) || pullRequest <= 0)) {
      throw new Error("ENGINEERING_MEMORY_PULL_REQUEST_INVALID");
    }
    const evidence = Array.isArray(input.evidence)
      ? [...new Set(input.evidence.map(value => String(value).trim()).filter(Boolean))].sort()
      : [];
    if (evidence.some(value => value.length > 500)) {
      throw new Error("ENGINEERING_MEMORY_EVIDENCE_INVALID");
    }
    return {
      eventType,
      gate,
      status,
      summary,
      repositoryFingerprint,
      pullRequest,
      mergeSha,
      evidence
    };
  }

  readLedger() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const text = fs.readFileSync(this.ledgerPath, "utf8");
    if (!text.trim()) return [];
    const events = text.trimEnd().split(/\r?\n/).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) {
        throw new Error(`ENGINEERING_MEMORY_LEDGER_INVALID_LINE_${index + 1}: ${error.message}`);
      }
    });
    let previousHash = "GENESIS";
    events.forEach((event, index) => {
      if (
        event.sequence !== index + 1 ||
        event.previousHash !== previousHash ||
        !/^[A-F0-9]{64}$/.test(event.eventHash || "") ||
        eventHash(event) !== event.eventHash
      ) {
        throw new Error(`ENGINEERING_MEMORY_CHAIN_INVALID_AT_${index + 1}`);
      }
      previousHash = event.eventHash;
    });
    return events;
  }

  createEvent(input, events) {
    const normalized = this.normalizeInput(input);
    const identityHash = sha256(
      Buffer.from(JSON.stringify(stable(normalized)), "utf8")
    );
    const existing = events.find(event => event.identityHash === identityHash);
    if (existing) {
      return { event: existing, duplicate: true };
    }
    const event = {
      sequence: events.length + 1,
      eventId: `ENGINEERING-MEMORY-${identityHash.slice(0, 16)}`,
      identityHash,
      recordedAt: new Date(this.now()).toISOString(),
      previousHash: events.at(-1)?.eventHash || "GENESIS",
      ...normalized
    };
    event.eventHash = eventHash(event);
    return { event, duplicate: false };
  }

  buildSnapshot(events) {
    const lockedGates = {};
    const milestones = {};
    for (const event of events) {
      if (event.eventType === "GATE_LOCKED") {
        lockedGates[event.gate] = {
          status: event.status,
          eventId: event.eventId,
          recordedAt: event.recordedAt,
          pullRequest: event.pullRequest,
          mergeSha: event.mergeSha,
          repositoryFingerprint: event.repositoryFingerprint
        };
      }
      if (event.eventType === "MILESTONE_LOCKED") {
        milestones[event.gate] = {
          status: event.status,
          eventId: event.eventId,
          recordedAt: event.recordedAt
        };
      }
    }
    return {
      ok: true,
      service: this.service,
      status: "HEALTHY",
      eventCount: events.length,
      lastSequence: events.at(-1)?.sequence || 0,
      chainHead: events.at(-1)?.eventHash || "GENESIS",
      lockedGateCount: Object.keys(lockedGates).length,
      lockedMilestoneCount: Object.keys(milestones).length,
      lockedGates,
      milestones,
      lastEvent: events.at(-1) || null,
      generatedAt: new Date(this.now()).toISOString()
    };
  }

  atomicWrite(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, content, "utf8");
    try { fs.renameSync(temporary, filePath); }
    catch {
      fs.copyFileSync(temporary, filePath);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  acquireLock() {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    try {
      const descriptor = fs.openSync(this.lockPath, "wx");
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: new Date(this.now()).toISOString() }));
      fs.closeSync(descriptor);
    } catch {
      throw new Error("ENGINEERING_MEMORY_LOCK_UNAVAILABLE");
    }
  }

  releaseLock() {
    try { fs.unlinkSync(this.lockPath); } catch {}
  }

  record(input = {}) {
    const existing = this.readLedger();
    const proposed = this.createEvent(input, existing);
    const previewEvents = proposed.duplicate ? existing : [...existing, proposed.event];
    if (input.apply !== true) {
      return {
        ok: true,
        service: this.service,
        mode: "PLAN_ONLY",
        duplicate: proposed.duplicate,
        event: proposed.event,
        snapshot: this.buildSnapshot(previewEvents),
        writesPerformed: false
      };
    }
    this.acquireLock();
    try {
      const current = this.readLedger();
      const currentProposal = this.createEvent(input, current);
      const events = currentProposal.duplicate ? current : [...current, currentProposal.event];
      const snapshot = this.buildSnapshot(events);
      if (!currentProposal.duplicate) {
        this.atomicWrite(
          this.ledgerPath,
          `${events.map(event => JSON.stringify(event)).join("\n")}\n`
        );
      }
      this.atomicWrite(this.snapshotPath, JSON.stringify(snapshot, null, 2));
      return {
        ok: true,
        service: this.service,
        mode: "APPLY",
        duplicate: currentProposal.duplicate,
        event: currentProposal.event,
        snapshot,
        ledgerPath: this.ledgerPath,
        ledgerSha256: sha256(fs.readFileSync(this.ledgerPath)),
        snapshotPath: this.snapshotPath,
        snapshotSha256: sha256(fs.readFileSync(this.snapshotPath)),
        writesPerformed: !currentProposal.duplicate,
        sourceWritesPerformed: false,
        gitWritesPerformed: false,
        mergePerformed: false,
        deploymentPerformed: false
      };
    } finally {
      this.releaseLock();
    }
  }
}

module.exports = PersistentEngineeringMemoryService;
module.exports.PersistentEngineeringMemoryService = PersistentEngineeringMemoryService;
module.exports.sha256 = sha256;
module.exports.eventHash = eventHash;

