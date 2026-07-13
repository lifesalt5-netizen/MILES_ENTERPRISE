"use strict";

const fs = require("fs");
const path = require("path");
const BaseProvider = require("./BaseProvider");

class InstantlyProvider extends BaseProvider {
  constructor(options = {}) {
    super({ name: "InstantlyProvider" });
    this.mode = options.mode || process.env.INSTANTLY_PROVIDER_MODE || "EXPORT_CSV";
    this.exportDir = path.join(process.cwd(), "DATA", "exports", "instantly");
    fs.mkdirSync(this.exportDir, { recursive: true });
  }

  csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  async uploadSegment(job = {}) {
    const now = new Date().toISOString();

    if (this.mode === "LIVE") {
      throw new Error("LIVE Instantly mode is disabled until official authentication and upload method are configured.");
    }

    const filename = `${job.campaignId}_${job.segmentId}_${Date.now()}.csv`
      .replace(/[^a-zA-Z0-9_.-]/g, "_");

    const filePath = path.join(this.exportDir, filename);

    const rows = [
      ["segmentId", "segmentName", "campaignId", "campaignName", "approvedUploadCount", "domain", "queueId"],
      [
        job.segmentId,
        job.segmentName,
        job.campaignId,
        job.campaignName,
        job.approvedUploadCount,
        job.domain,
        job.queueId
      ]
    ];

    fs.writeFileSync(
      filePath,
      rows.map(row => row.map(v => this.csvEscape(v)).join(",")).join("\n"),
      "utf8"
    );

    return {
      ok: true,
      dryRun: false,
      exportOnly: true,
      provider: this.name,
      mode: this.mode,
      action: "EXPORT_INSTANTLY_UPLOAD_FILE",
      uploaded: false,
      exportFile: filePath,
      message: "Created Instantly-ready export file. No live upload performed.",
      job,
      completedAt: now
    };
  }
}

module.exports = InstantlyProvider;
