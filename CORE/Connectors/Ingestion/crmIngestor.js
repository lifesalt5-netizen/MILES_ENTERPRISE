"use strict";

const { emitEvent } = require("../../../event-bus/emitter");

class CRMIngestor {

  receiveDealUpdate(deal) {

    emitEvent("DEAL_UPDATED", {
      id: deal.id,
      stage: deal.stage,
      value: deal.value,
      owner: deal.owner,
      timestamp: Date.now()
    });

    console.log("[INGEST] CRM → DEAL_UPDATED");
  }
}

module.exports = CRMIngestor;