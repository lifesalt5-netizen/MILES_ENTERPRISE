"use strict";

const { google } = require("googleapis");
const { emitEvent } = require("../../event-bus/emitter");

class GmailListener {

  constructor(auth) {
    this.auth = auth;
    this.gmail = null;
  }

  async init() {
    if (!this.auth) return;

    this.gmail = google.gmail({
      version: "v1",
      auth: this.auth
    });
  }

  async pollInbox() {

    if (!this.gmail) await this.init();
    if (!this.gmail) return;

    const res = await this.gmail.users.messages.list({
      userId: "me",
      maxResults: 5
    });

    const messages = res.data.messages || [];

    for (const msg of messages) {

      const full = await this.gmail.users.messages.get({
        userId: "me",
        id: msg.id
      });

      emitEvent("REPLY_RECEIVED", {
        id: msg.id,
        snippet: full.data.snippet,
        source: "gmail"
      });

      console.log("[MILES] Gmail → REPLY_RECEIVED");
    }
  }
}

module.exports = GmailListener;