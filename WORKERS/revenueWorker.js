"use strict";

const { bus } = require("../event-bus/emitter");
const AutonomousRevenueClosureLoop = require("../SERVICES/AutonomousRevenueClosureLoop");
const P2GCCalendlyReminderGuardService = require("../SERVICES/P2GCCalendlyReminderGuardService");

console.log(
  "[DEBUG] Revenue Loop Loaded From:",
  require.resolve("../SERVICES/AutonomousRevenueClosureLoop")
);

const revenue = new AutonomousRevenueClosureLoop();
const p2gcMeetingReminders = new P2GCCalendlyReminderGuardService();
const REMINDER_GUARD_INTERVAL_MS = Math.max(
  30000,
  Number(process.env.MILES_P2GC_CALENDLY_REMINDER_INTERVAL_MS || 60000)
);
let reminderGuardRunning = false;

async function runReminderGuard() {
  if (reminderGuardRunning) return;
  reminderGuardRunning = true;
  try {
    const result = await p2gcMeetingReminders.runOnce();
    if (result?.ok !== true) {
      console.error("[P2GC CALENDLY REMINDER GUARD] DEGRADED", result?.status || "UNKNOWN", result?.failures || []);
    } else if (Array.isArray(result.actions) && result.actions.length) {
      console.log("[P2GC CALENDLY REMINDER GUARD] ACTIONS", JSON.stringify(result.actions));
    }
  } catch (error) {
    console.error("[P2GC CALENDLY REMINDER GUARD] ERROR", error.message);
  } finally {
    reminderGuardRunning = false;
  }
}

// Lightweight meeting-notification guard. Calendly remains the source of truth for
// booking confirmation; MILES enforces the 24-hour reminder and duplicate suppression.
setTimeout(() => {
  runReminderGuard().catch(error => console.error("[P2GC CALENDLY REMINDER GUARD] INITIAL ERROR", error.message));
}, 5000);

const reminderGuardTimer = setInterval(() => {
  runReminderGuard().catch(error => console.error("[P2GC CALENDLY REMINDER GUARD] LOOP ERROR", error.message));
}, REMINDER_GUARD_INTERVAL_MS);
reminderGuardTimer.unref?.();

bus.on("COO_RESULT", async (state) => {
  const result = await revenue.run(state);
  console.log("[REVENUE] Emitting REVENUE_RESULT");
  bus.emit("REVENUE_RESULT", result);
});
