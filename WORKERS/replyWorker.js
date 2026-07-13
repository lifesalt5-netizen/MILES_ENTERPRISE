"use strict";

const { bus } = require("../event-bus/emitter");
const ReplyIntelligenceEngine =
  require("../SERVICES/ReplyIntelligenceEngine");

const reply = new ReplyIntelligenceEngine({});

bus.on("REPLY_RECEIVED", async (data) => {
  const result = await reply.processReplies([data]);
  bus.emit("REPLY_RESULT", result);
});