"use strict";

const fs = require("fs");
const path = require("path");

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class RevenueMeetingInventoryService {
  constructor(options = {}) {
    const root = options.root || process.env.MILES_ROOT || process.cwd();
    this.pipelineFile =
      options.pipelineFile ||
      path.join(
        root,
        "DATA",
        "revenue_pipeline",
        "latest_calendly_meeting_pipeline.json"
      );
  }

  read() {
    if (!fs.existsSync(this.pipelineFile)) {
      return {
        ok: false,
        status: "MEETING_PIPELINE_UNAVAILABLE",
        source: this.pipelineFile,
        p2gcEvents: 0,
        activeMeetings: 0,
        upcomingMeetings: 0,
        pastActiveMeetings: 0,
        canceledMeetings: 0
      };
    }

    try {
      const raw = JSON.parse(
        fs.readFileSync(this.pipelineFile, "utf8").replace(/^\uFEFF/, "")
      );

      const metrics = raw.metrics || raw.summary || {};

      return {
        ok: raw.ok !== false,
        status: raw.status || "Healthy",
        source: this.pipelineFile,
        generatedAt: raw.generatedAt || raw.syncedAt || raw.updatedAt || null,
        account: raw.account || raw.email || null,
        p2gcEvents: number(
          metrics.p2gcEvents ?? raw.p2gcEvents ?? raw.p2gc_events,
          0
        ),
        activeMeetings: number(
          metrics.activeMeetings ?? raw.activeMeetings ?? raw.active_meetings,
          0
        ),
        upcomingMeetings: number(
          metrics.upcomingMeetings ?? raw.upcomingMeetings ?? raw.upcoming_meetings,
          0
        ),
        pastActiveMeetings: number(
          metrics.pastActiveMeetings ?? raw.pastActiveMeetings ?? raw.past_active_meetings,
          0
        ),
        canceledMeetings: number(
          metrics.canceledMeetings ?? raw.canceledMeetings ?? raw.canceled_meetings,
          0
        )
      };
    } catch (error) {
      return {
        ok: false,
        status: "MEETING_PIPELINE_READ_FAILED",
        source: this.pipelineFile,
        error: error.message,
        p2gcEvents: 0,
        activeMeetings: 0,
        upcomingMeetings: 0,
        pastActiveMeetings: 0,
        canceledMeetings: 0
      };
    }
  }
}

module.exports = RevenueMeetingInventoryService;
