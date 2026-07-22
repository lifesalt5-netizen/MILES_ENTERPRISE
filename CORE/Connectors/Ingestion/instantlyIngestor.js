"use strict";

const { emitEvent } = require("../../../event-bus/emitter");

class InstantlyIngestor {

  receiveLead(lead) {

    emitEvent("LEAD_CREATED", {
      email: lead.email,
      name: lead.name,
      company: lead.company,
      score: lead.score || 50,
      timestamp: Date.now()
    });

    console.log("[INGEST] Instantly → LEAD_CREATED");
  }
}

module.exports = InstantlyIngestor;