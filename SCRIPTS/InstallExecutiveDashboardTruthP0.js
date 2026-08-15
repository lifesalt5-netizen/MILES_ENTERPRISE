"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "DashboardDataService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_EXEC_DASHBOARD_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("function isSyntheticDashboardDeal")) {
  const anchor = "function durationMs(startedAt, completedAt) {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate helper insertion anchor.");
  const helper = `function isSyntheticDashboardDeal(item = {}) {\n    const text = [item.id,item.name,item.company,item.contactName,item.email,item.source]\n        .filter(Boolean).join(\" \" ).toLowerCase();\n    return /build[ _-]?e010|test company|example\\.com|unknown target/.test(text);\n}\n\n`;
  text = text.slice(0, idx) + helper + text.slice(idx);
}

if (!text.includes("const authoritativeDealsState = readJson(")) {
  const anchor = `        const workArchive = readJson(\n            "DATA\\\\runtime\\\\work_queue_archive.json",\n            []\n        );`;
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate workArchive source block.");
  const patch = `${anchor}\n\n        const taskQueue = readJson(\n            \"DATA\\\\runtime\\\\task_queue.json\",\n            []\n        );\n\n        const authoritativeDealsState = readJson(\n            \"DATA\\\\runtime\\\\latest_deals.json\",\n            { deals: [] }\n        );`;
  text = text.slice(0, idx) + patch + text.slice(idx + anchor.length);
}

const oldItems = `        const items =\n            queueItems(workQueue);`;
const newItems = `        const workItems = queueItems(workQueue);\n        const taskItems = Array.isArray(taskQueue) ? taskQueue : queueItems(taskQueue);\n        const itemMap = new Map();\n        for (const item of [...workItems, ...taskItems]) {\n            if (!item || typeof item !== \"object\") continue;\n            const key = String(item.id || item.taskId || item.operationId || [item.title,item.createdAt,item.action].join(\"|\"));\n            if (!itemMap.has(key)) itemMap.set(key, item);\n        }\n        const items = [...itemMap.values()];`;
if (text.includes(oldItems)) text = text.replace(oldItems, newItems);
else if (!text.includes("const taskItems = Array.isArray(taskQueue)")) throw new Error("Could not locate work queue items block.");

const oldDeals = `        const deals =\n            array(business.deals);`;
const newDeals = `        const authoritativeDeals = array(authoritativeDealsState.deals)\n            .filter(deal => !isSyntheticDashboardDeal(deal))\n            .filter(deal => String(deal?.status || \"ACTIVE\").toUpperCase() === \"ACTIVE\");\n\n        const deals = authoritativeDeals.length\n            ? authoritativeDeals\n            : array(business.deals).filter(deal => !isSyntheticDashboardDeal(deal));`;
if (text.includes(oldDeals)) text = text.replace(oldDeals, newDeals);
else if (!text.includes("const authoritativeDeals = array(authoritativeDealsState.deals)")) throw new Error("Could not locate deals block.");

const oldPipeline = `        const pipelineValue =\n            firstDefined(\n                revenue.pipeline,\n                revenue.pipelineValue,\n                sumNumbers(\n                    deals,\n                    [\n                        "weightedValue",\n                        "pipelineValue",\n                        "value",\n                        "amount",\n                        "estimatedValue"\n                    ]\n                )\n            );`;
const newPipeline = `        const authoritativePipelineValue = authoritativeDeals.length\n            ? sumNumbers(authoritativeDeals, [\"value\",\"amount\",\"estimatedValue\",\"pipelineValue\"])\n            : 0;\n        const authoritativeWeightedForecast = authoritativeDeals.length\n            ? sumNumbers(authoritativeDeals, [\"weightedValue\"])\n            : 0;\n        const pipelineValue = authoritativeDeals.length\n            ? authoritativePipelineValue\n            : firstDefined(\n                revenue.pipeline,\n                revenue.pipelineValue,\n                sumNumbers(deals, [\"value\",\"amount\",\"estimatedValue\",\"pipelineValue\",\"weightedValue\"])\n            );`;
if (text.includes(oldPipeline)) text = text.replace(oldPipeline, newPipeline);
else if (!text.includes("const authoritativePipelineValue = authoritativeDeals.length")) throw new Error("Could not locate pipeline block.");

// Expose truth provenance in the returned dashboard contract.
const contractAnchor = `            root:\n                ROOT,`;
if (text.includes(contractAnchor) && !text.includes("truthSources:")) {
  const replacement = `${contractAnchor}\n\n            truthSources: {\n                deals: \"DATA/runtime/latest_deals.json\",\n                workQueue: \"DATA/runtime/work_queue.json\",\n                taskQueue: \"DATA/runtime/task_queue.json\",\n                orion: \"DATA/orion_coo/latest_orion_operation.json\",\n                syntheticDealsExcluded: true,\n                authoritativeDealCount: authoritativeDeals.length,\n                authoritativePipelineValue,\n                authoritativeWeightedForecast\n            },`;
  text = text.replace(contractAnchor, replacement);
}

if (text === original) throw new Error("No changes applied.");
fs.writeFileSync(file, text, "utf8");
console.log("=== EXECUTIVE DASHBOARD TRUTH P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : canonical latest_deals + task_queue + synthetic filtering + truth provenance");
console.log("next   : node --check .\\SERVICES\\DashboardDataService.js");
