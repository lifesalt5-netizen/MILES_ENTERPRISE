"use strict";

const fs = require("fs");

const dupes = require("./DATA/enterprise_inventory/duplicate_files.json");

const lines = [];

lines.push("MILES ENTERPRISE DUPLICATE ANALYSIS");
lines.push("==================================");
lines.push("");

for (const d of dupes) {

    lines.push("------------------------------------------------");
    lines.push(`FILE: ${d.name}`);
    lines.push(`COPIES: ${d.count}`);
    lines.push("");

    d.files.forEach((f, i) => {
        lines.push(`${i + 1}. ${f}`);
    });

    lines.push("");
}

fs.writeFileSync(
    "./DATA/enterprise_inventory/DUPLICATE_REPORT.txt",
    lines.join("\r\n"),
    "utf8"
);

console.log("");
console.log("================================");
console.log("Duplicate Report Created");
console.log("================================");
console.log(`Duplicates: ${dupes.length}`);
console.log("Report:");
console.log("./DATA/enterprise_inventory/DUPLICATE_REPORT.txt");
console.log("");

