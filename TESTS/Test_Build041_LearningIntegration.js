"use strict";

const LearningDataService = require("../SERVICES/LearningDataService");

const result = LearningDataService.collect();

console.log("\n=== BUILD 041 Learning Integration ===\n");

console.log("OK:", result.ok);
console.log("Generated:", result.generatedAt);

console.log(
    "Resolution Records:",
    result.learning?.resolutions?.length || 0
);

if ((result.learning?.resolutions?.length || 0) > 0) {
    console.log("\nLatest Resolution:");
    console.log(
        result.learning.resolutions[
            result.learning.resolutions.length - 1
        ]
    );
}

console.log("\nPASS");