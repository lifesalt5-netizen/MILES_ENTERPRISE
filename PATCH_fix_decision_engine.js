"use strict";

const fs = require("fs");

const file = ".\\EXECUTIVE\\ExecutiveDecisionEngine.js";
let text = fs.readFileSync(file, "utf8");

text = text.replace(
`      readySegments: segments.filter(s =>
        s.readyForUpload === 1 ||
        String(s.uploadStatus || "").toUpperCase().includes("READY")
      ),`,
`      readySegments: segments.filter(s =>
        s.readyForUpload === 1 ||
        String(s.uploadStatus || "").toUpperCase() === "READY_FOR_REVIEW"
      ),`
);

text = text.replace(
`    if (state.readySegments.length > 0 && state.totalDailyCapacity > 0 && state.pendingApprovals.length === 0 && state.readyUploads.length === 0) {`,
`    const handledPairs = new Set(
      state.queue
        .filter(q => ["PENDING_APPROVAL","READY_FOR_UPLOAD","UPLOADED","DRY_RUN_COMPLETED","COMPLETED"].includes(String(q.status || "").toUpperCase()))
        .map(q => String(q.segmentId) + "::" + String(q.campaignId))
    );

    const unhandledReadySegments = state.readySegments.filter(segment => {
      return state.campaigns.some(campaign => !handledPairs.has(String(segment.id) + "::" + String(campaign.id)));
    });

    if (unhandledReadySegments.length > 0 && state.totalDailyCapacity > 0 && state.pendingApprovals.length === 0 && state.readyUploads.length === 0) {`
);

text = text.replace(
`${state.readySegments.length} segments are ready and ${state.totalDailyCapacity}/day capacity is available.`,
`${unhandledReadySegments.length} unhandled ready segments are available and ${state.totalDailyCapacity}/day capacity is available.`
);

text = text.replace(
`payload: { readySegments: state.readySegments.length, totalDailyCapacity: state.totalDailyCapacity }`,
`payload: { readySegments: state.readySegments.length, unhandledReadySegments: unhandledReadySegments.length, totalDailyCapacity: state.totalDailyCapacity }`
);

fs.writeFileSync(file, text, "utf8");
