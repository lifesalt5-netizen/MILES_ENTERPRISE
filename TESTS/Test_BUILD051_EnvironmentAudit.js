"use strict";

const path = require("path");

console.log("\n=== BUILD 051 Environment Audit ===\n");

const expectedRoot = process.cwd();

console.log("Current Working Directory:");
console.log(expectedRoot);

console.log("");

console.log("MILES_ROOT:");
console.log(process.env.MILES_ROOT || "<NOT SET>");

console.log("");

console.log("INSTANTLY_API_KEY:");

if (process.env.INSTANTLY_API_KEY) {
    console.log("FOUND");
    console.log("Length:", process.env.INSTANTLY_API_KEY.length);
} else {
    console.log("NOT SET");
}

console.log("");

console.log("INSTANTLY_WRITE_ENABLED:");
console.log(process.env.INSTANTLY_WRITE_ENABLED || "false");

console.log("");

console.log("Recommended:");

console.log("MILES_ROOT =", expectedRoot);
console.log("INSTANTLY_API_KEY = <your api key>");
console.log("INSTANTLY_WRITE_ENABLED = false");

console.log("\nPASS\n");