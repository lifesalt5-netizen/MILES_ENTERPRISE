"use strict";

const fs = require("fs");
const path = require("path");
const commandQueue = require("../CORE/CommandQueue");

const ROOT = process.env.MILES_ROOT || process.cwd();
const ENGINEERING_DIR = path.join(ROOT, "ENGINEERING");
const TICKETS_DIR = path.join(ENGINEERING_DIR, "Tickets");
const MISSIONS_DIR = path.join(ENGINEERING_DIR, "Missions");

function now() {
  return new Date().toISOString();
}

function ensureDirs() {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
  fs.mkdirSync(MISSIONS_DIR, { recursive: true });
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class ExecutiveDispatcher {
  constructor() {
    ensureDirs();
  }

  acceptMission(mission = {}) {
    const missionRecord = {
      id: mission.id || id("MISSION"),
      title: mission.title || "Untitled Mission",
      objective: mission.objective || mission.title || "No objective supplied",
      priority: mission.priority || 1,
      authority: mission.authority || "GOVERNANCE_V3",
      status: "ACCEPTED",
      createdAt: now(),
      updatedAt: now(),
      tasks: []
    };

    missionRecord.tasks = this.planMission(missionRecord);

    this.persistMission(missionRecord);

    for (const task of missionRecord.tasks) {
      commandQueue.add({
        title: task.title,
        type: task.type,
        priority: task.priority,
        authority: task.authority,
        payload: task
      });

      this.persistTicket(task);
    }

    return missionRecord;
  }

  planMission(mission) {
    const objective = String(mission.objective || "").toLowerCase();

    if (
      objective.includes("self") ||
      objective.includes("engineering") ||
      objective.includes("build miles") ||
      objective.includes("autonomy")
    ) {
      return this.selfDevelopmentPlan(mission);
    }

    if (
      objective.includes("runtime") ||
      objective.includes("drift") ||
      objective.includes("atlas")
    ) {
      return this.runtimeRepairPlan(mission);
    }

    return this.generalImprovementPlan(mission);
  }

  selfDevelopmentPlan(mission) {
    return [
      this.task(mission, "Build Source Code Registry", "ARCHITECT", 1),
      this.task(mission, "Build Autonomous Builder Service", "BUILDER", 1),
      this.task(mission, "Build Validator Service", "VALIDATOR", 1),
      this.task(mission, "Build Tester Service", "TESTER", 2),
      this.task(mission, "Build Deployer Service", "DEPLOYER", 2),
      this.task(mission, "Build Recovery Service", "RECOVERY", 2),
      this.task(mission, "Upgrade ATLAS to create engineering tickets", "ATLAS", 1)
    ];
  }

  runtimeRepairPlan(mission) {
    return [
      this.task(mission, "Inspect Runtime Drift", "ATLAS", 1),
      this.task(mission, "Generate Repair Plan", "ARCHITECT", 1),
      this.task(mission, "Validate Repair Safety", "VALIDATOR", 1),
      this.task(mission, "Deploy Safe Runtime Repair", "DEPLOYER", 2)
    ];
  }

  generalImprovementPlan(mission) {
    return [
      this.task(mission, "Analyze Mission Requirements", "ARCHITECT", 1),
      this.task(mission, "Create Implementation Plan", "BUILDER", 2),
      this.task(mission, "Validate Implementation Plan", "VALIDATOR", 2),
      this.task(mission, "Prepare Executive Report", "ATLAS", 3)
    ];
  }

  task(mission, title, owner, priority) {
    return {
      id: id("TICKET"),
      missionId: mission.id,
      title,
      type: owner,
      owner,
      priority,
      authority: "AUTOMATIC_ENGINEERING",
      status: "QUEUED",
      createdAt: now(),
      updatedAt: now(),
      approvalRequired: false,
      payload: {
        missionTitle: mission.title,
        objective: mission.objective
      }
    };
  }

  persistMission(mission) {
    fs.writeFileSync(
      path.join(MISSIONS_DIR, `${mission.id}.json`),
      JSON.stringify(mission, null, 2)
    );
  }

  persistTicket(ticket) {
    fs.writeFileSync(
      path.join(TICKETS_DIR, `${ticket.id}.json`),
      JSON.stringify(ticket, null, 2)
    );
  }
}

module.exports = new ExecutiveDispatcher();