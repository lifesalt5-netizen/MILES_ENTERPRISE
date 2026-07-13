"use strict";

const { bus } = require("../event-bus/emitter");
const DealClosureEngine =
  require("../SERVICES/DealClosureEngine");

const deal = new DealClosureEngine({});

bus.on("REVENUE_RESULT", async (data) => {

  const deals = data?.results?.qualified || [];

  const result = await deal.run(deals);

  bus.emit("DEAL_RESULT", result);
});