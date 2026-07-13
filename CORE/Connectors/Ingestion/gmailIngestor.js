"use strict";

const { emitEvent } = require("../../event-bus/emitter");

class GmailIngestor {

  receiveEmail(email) {

    emitEvent("REPLY_RECEIVED", {
      from: email.from,
      subject: email.subject,
      body: email.body,
      timestamp: Date.now()
    });

    console.log("[INGEST] Gmail → REPLY_RECEIVED");
  }
}

module.exports = GmailIngestor;