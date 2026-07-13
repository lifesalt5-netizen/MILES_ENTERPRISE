"use strict";

const { importDomainsAndInboxes } = require("./DIGITAL_COO/Marketing/DomainInboxImporter");

const result = importDomainsAndInboxes();

console.log("");
console.log("=====================================");
console.log("MILES DOMAINS + INBOXES IMPORTED");
console.log("=====================================");
console.log(JSON.stringify(result, null, 2));
console.log("=====================================");
console.log("");
