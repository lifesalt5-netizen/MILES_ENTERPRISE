"use strict";

const os = require("os");

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class RuntimeResourceGovernorService {
  constructor(options = {}) {
    this.minimumFreeMemoryRatio = positive(
      options.minimumFreeMemoryRatio ||
        process.env.MILES_MINIMUM_FREE_MEMORY_RATIO,
      0.12
    );
    this.maximumProcessRssBytes =
      positive(
        options.maximumProcessRssMb ||
          process.env.MILES_MAX_PROCESS_RSS_MB,
        1536
      ) * 1024 * 1024;
    this.maximumQueueDepth = positive(
      options.maximumQueueDepth ||
        process.env.MILES_MAX_QUEUE_DEPTH,
      100
    );
    this.lastSnapshot = null;
    this.metrics = {
      checks: 0,
      allowed: 0,
      throttled: 0,
      circuitBreaks: 0
    };
  }

  inspect(queueDepth = 0) {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memory = process.memoryUsage();
    const freeMemoryRatio =
      totalMemory > 0 ? freeMemory / totalMemory : 0;
    const reasons = [];

    if (freeMemoryRatio < this.minimumFreeMemoryRatio) {
      reasons.push("LOW_SYSTEM_MEMORY");
    }
    if (memory.rss > this.maximumProcessRssBytes) {
      reasons.push("PROCESS_RSS_LIMIT");
    }
    if (Number(queueDepth) >= this.maximumQueueDepth) {
      reasons.push("QUEUE_BACKPRESSURE");
    }

    this.metrics.checks += 1;

    const snapshot = {
      ok: reasons.length === 0,
      generatedAt: new Date().toISOString(),
      queueDepth: Number(queueDepth) || 0,
      system: {
        totalMemoryBytes: totalMemory,
        freeMemoryBytes: freeMemory,
        freeMemoryRatio
      },
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external
      },
      limits: {
        minimumFreeMemoryRatio: this.minimumFreeMemoryRatio,
        maximumProcessRssBytes: this.maximumProcessRssBytes,
        maximumQueueDepth: this.maximumQueueDepth
      },
      reasons
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  authorize(activity, queueDepth = 0) {
    const snapshot = this.inspect(queueDepth);
    const lowMemory = snapshot.reasons.includes("LOW_SYSTEM_MEMORY");
    const processLimit = snapshot.reasons.includes("PROCESS_RSS_LIMIT");
    const backpressure = snapshot.reasons.includes("QUEUE_BACKPRESSURE");
    const isGeneration = String(activity).toUpperCase() === "GENERATION";
    const allowed =
      !lowMemory &&
      !processLimit &&
      !(isGeneration && backpressure);

    if (allowed) {
      this.metrics.allowed += 1;
    } else {
      this.metrics.throttled += 1;
      if (lowMemory || processLimit) this.metrics.circuitBreaks += 1;
    }

    return {
      allowed,
      activity: String(activity).toUpperCase(),
      reason: allowed ? null : snapshot.reasons.join("|"),
      snapshot
    };
  }

  status() {
    return {
      ok: true,
      service: "RuntimeResourceGovernorService",
      metrics: { ...this.metrics },
      lastSnapshot: this.lastSnapshot
    };
  }
}

module.exports = new RuntimeResourceGovernorService();
module.exports.RuntimeResourceGovernorService = RuntimeResourceGovernorService;
