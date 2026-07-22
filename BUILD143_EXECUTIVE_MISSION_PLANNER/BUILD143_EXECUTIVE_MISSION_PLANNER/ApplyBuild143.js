'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('MILES root argument is required.');
const file = path.join(root, 'SERVICES', 'CommandIntentPlannerService.js');
if (!fs.existsSync(file)) throw new Error(`Planner not found: ${file}`);
let s = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
if (s.includes('isActionableExecutiveMission(text)')) {
  console.log('[BUILD143] Planner already contains Executive Mission support.');
  process.exit(0);
}
function replaceOnce(anchor, replacement, label) {
  const index = s.indexOf(anchor);
  if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
  s = s.slice(0, index) + replacement + s.slice(index + anchor.length);
}
const conversation = `    // Executive conversation and advisory requests\nif (\n    /what can you do|supported action|who are you|hello|hi|help|how can you help|explain|what do you think|should we|recommend|why|how\\b|what\\b/i.test(text)\n) {\n    return "CONVERSATION";\n}\n`;
replaceOnce(conversation, `    /* Actionable CEO objectives become executable missions before chat fallback. */\n    if (this.isActionableExecutiveMission(text)) {\n      return "EXECUTIVE_MISSION";\n    }\n\n    // Executive conversation and advisory requests\n    if (\n      /what can you do|supported action|who are you|hello|hi|help|how can you help|explain|what do you think|should we|recommend|why|how\\b|what\\b/i.test(text)\n    ) {\n      return "CONVERSATION";\n    }\n`, 'conversation fallback');
replaceOnce('  isRevenueOperationsMission(text) {\n', `  isActionableExecutiveMission(text) {\n    const hasBusinessObjective =\n      /revenue|sales|pipeline|prospect|client|customer|business|opportunit|growth|marketing|outbound|proposal|deal|priority|department|action plan|work package|assign work|execute|implementation|mission/.test(text);\n\n    const hasExecutionVerb =\n      /review|assess|audit|analyze|identify|prioritize|rank|select|assign|create|build|produce|develop|execute|launch|manage|operate|improve|increase|reduce|plan|coordinate|implement/.test(text);\n\n    const hasMissionSignal =\n      /assign.*(work|department|team)|executive action plan|highest-priority|highest priority|top \\d+|three highest|multi-step|across.*department|appropriate department|create.*work package|produce.*plan|identify.*opportunit/.test(text);\n\n    return hasMissionSignal || (hasBusinessObjective && hasExecutionVerb);\n  }\n\n  isRevenueOperationsMission(text) {\n`, 'mission classifier method');
const revenueWorkflow = `    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n      return "REVENUE_OPERATIONS_MISSION";\n    }\n`;
replaceOnce(revenueWorkflow, revenueWorkflow + `\n    if (\n      intent ===\n      "EXECUTIVE_MISSION"\n    ) {\n      return "EXECUTIVE_MISSION_PLANNING";\n    }\n`, 'workflow branch');
const businessCapability = `    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n      return "BUSINESS_EXECUTION";\n    }\n\n    if (\n      intent ===\n      "EXECUTIVE_STATUS"\n`;
const missionCapability = `    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n      return "BUSINESS_EXECUTION";\n    }\n\n    if (\n      intent ===\n      "EXECUTIVE_MISSION"\n    ) {\n      return "BUSINESS_EXECUTION";\n    }\n\n    if (\n      intent ===\n      "EXECUTIVE_STATUS"\n`;
replaceOnce(businessCapability, missionCapability, 'capability branch');
replaceOnce('        "REVENUE_OPERATIONS",\n        "EXECUTIVE_STATUS",', '        "REVENUE_OPERATIONS",\n        "EXECUTIVE_MISSION",\n        "EXECUTIVE_STATUS",', 'provider branch');
replaceOnce(businessCapability, missionCapability, 'action branch');
const dept = `    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n      return "Revenue Operations";\n    }\n\n    if (\n      intent === "ENGINEERING"\n`;
replaceOnce(dept, `    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n      return "Revenue Operations";\n    }\n\n    if (\n      intent ===\n      "EXECUTIVE_MISSION"\n    ) {\n      return "Executive Operations";\n    }\n\n    if (\n      intent === "ENGINEERING"\n`, 'department branch');
const stepsAnchor = `  ) {\n    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n`;
const last = s.lastIndexOf(stepsAnchor);
if (last < 0) throw new Error('Patch anchor not found: resolveSteps');
const steps = `  ) {\n    if (\n      intent ===\n      "EXECUTIVE_MISSION"\n    ) {\n      return [\n        { step: 1, provider: "MILES", connector: "MILES", capability: "COMPANY_STATE", action: "COMPANY_STATE", objective: "Review current business state, priorities, pipeline, work queues, constraints, and operating data." },\n        { step: 2, provider: "MILES", connector: "MILES", capability: "BUSINESS_EXECUTION", action: "BUSINESS_EXECUTION", objective: "Identify and prioritize the highest-impact opportunities required by the CEO objective." },\n        { step: 3, provider: "MILES", connector: "MILES", capability: "TASK_ROUTER", action: "TASK_ROUTER", objective: "Assign executable work to the appropriate departments, workers, and providers with dependencies and expected outputs." },\n        { step: 4, provider: "MILES", connector: "MILES", capability: "EXECUTIVE_DASHBOARD", action: "EXECUTIVE_DASHBOARD", objective: "Produce an executive action plan showing priorities, assignments, next actions, risks, and completion criteria." }\n      ];\n    }\n\n    if (\n      intent ===\n      "REVENUE_OPERATIONS"\n    ) {\n`;
s = s.slice(0, last) + steps + s.slice(last + stepsAnchor.length);
fs.writeFileSync(file, s, 'utf8');
console.log('[BUILD143] Executive Mission Planner applied.');
