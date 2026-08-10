"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const serviceFile = path.join(ROOT, "SERVICES", "StateSledFlActivationService.js");
const rulesFile = path.join(ROOT, "CONFIG", "state_sled_fl_activation_rules.json");

if (!fs.existsSync(serviceFile)) throw new Error("Activation service missing.");
if (!fs.existsSync(rulesFile)) throw new Error("Activation rules missing.");

const rules = JSON.parse(fs.readFileSync(rulesFile, "utf8"));
const src = fs.readFileSync(serviceFile, "utf8");

if (rules.authorizationToken !== "AUTHORIZE_STATE_SLED_FL_ACTIVATE") throw new Error("Activation token mismatch.");
if (rules.campaignName !== "STATE SLED - FL") throw new Error("Campaign name mismatch.");
if (!rules.campaignId) throw new Error("Campaign ID missing.");
if (rules.safety?.allowOnlyActivationMutation !== true) throw new Error("Activation-only mutation safety missing.");
if (!src.includes("ACTIVATE_CAMPAIGN")) throw new Error("Activation action missing.");
if (src.includes("CREATE_CAMPAIGN")) throw new Error("Activation service must not create campaigns.");
if (src.includes("CREATE_LEAD")) throw new Error("Activation service must not upload leads.");
if (src.includes("DELETE_CAMPAIGN")) throw new Error("Activation service must not delete campaigns.");
if (!src.includes("Launch readiness contains failed checks")) throw new Error("Launch-readiness gate missing.");
if (!src.includes("Campaign activation verification failed")) throw new Error("Post-activation verification missing.");

console.log("STATE_SLED_FL_ACTIVATION_TEST=PASS");
