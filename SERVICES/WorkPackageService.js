"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const planner = require("./PlannerService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const PACKAGE_DIR = path.join(ROOT, "DATA", "work_packages");

const ACTIVE_STATUSES = new Set([
  "AWAITING_APPROVAL",
  "QUEUED",
  "READY",
  "RUNNING",
  "IN_PROGRESS",
  "IN PROGRESS",
  "BLOCKED"
]);

function createId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

  const random = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `WP-${stamp}-${random}`;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .replace(/-/g, "_")
    .toUpperCase();
}

function buildSignature(objective, plan = {}, context = {}) {
  const steps = Array.isArray(plan.steps)
    ? plan.steps.map(step => ({
        capability: normalize(step.capability),
        provider: normalize(step.provider),
        department: normalize(step.department),
        action: normalize(step.action),
        assignedTo: normalize(step.assignedTo),
        taskType: normalize(step.taskType)
      }))
    : [];

  const signaturePayload = {
    objective: normalize(objective),
    approvalRequired: Boolean(plan.approvalRequired),
    department: normalize(context.department),
    provider: normalize(context.provider),
    capability: normalize(context.capability),
    action: normalize(context.action),
    steps
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(signaturePayload))
    .digest("hex");
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(
      "[BUILD053] Failed to read work package:",
      file,
      error.message
    );

    return null;
  }
}

class WorkPackageService {
  ensureDirectory() {
    fs.mkdirSync(PACKAGE_DIR, {
      recursive: true
    });
  }

  create(objective, context = {}) {
    this.ensureDirectory();

    const plan = planner.createPlan(
      objective,
      context
    );

    const signature = buildSignature(
      objective,
      plan,
      context
    );

    const existing =
      this.findActiveBySignature(signature);

    if (existing) {
      console.log(
        "[BUILD053] Work package reused:",
        {
          id: existing.id,
          signature,
          status: existing.status,
          objective: existing.objective
        }
      );

      return {
        ...existing,
        reused: true,
        creationDecision: "REUSED"
      };
    }

    const timestamp =
      new Date().toISOString();

    const workPackage = {
      id: createId(),
      signature,
      objective,
      status: plan.approvalRequired
        ? "AWAITING_APPROVAL"
        : "QUEUED",
      owner: "MILES",
      priority: plan.priority,
      priorityScore: plan.priorityScore,
      createdAt: timestamp,
      updatedAt: timestamp,
      plan,
      tasks: Array.isArray(plan.steps)
        ? plan.steps
        : [],
      approvals: plan.approvalRequired
        ? [
            {
              required: true,
              reason:
                "CEO approval required by planning rules.",
              status: "PENDING",
              createdAt: timestamp
            }
          ]
        : [],
      results: [],
      verification: {
        required: true,
        status: "PENDING"
      },
      reused: false,
      creationDecision: "CREATED"
    };

    this.save(workPackage);

    console.log(
      "[BUILD053] Work package created:",
      {
        id: workPackage.id,
        signature,
        status: workPackage.status,
        objective: workPackage.objective
      }
    );

    return workPackage;
  }

  findActiveBySignature(signature) {
    if (!signature) {
      return null;
    }

    return (
      this.list().find(workPackage => {
        if (
          workPackage.signature !== signature
        ) {
          return false;
        }

        return ACTIVE_STATUSES.has(
          normalizeStatus(
            workPackage.status
          )
        );
      }) || null
    );
  }

  save(workPackage) {
    this.ensureDirectory();

    if (
      !workPackage ||
      !workPackage.id
    ) {
      throw new Error(
        "Cannot save a work package without an ID."
      );
    }

    const destination = path.join(
      PACKAGE_DIR,
      `${workPackage.id}.json`
    );

    const temporary =
      `${destination}.${process.pid}.tmp`;

    const text = JSON.stringify(
      workPackage,
      null,
      2
    );

    fs.writeFileSync(
      temporary,
      text,
      "utf8"
    );

    try {
      fs.renameSync(
        temporary,
        destination
      );
    } catch (error) {
      fs.copyFileSync(
        temporary,
        destination
      );

      fs.unlinkSync(temporary);
    }

    return workPackage;
  }

  list() {
    this.ensureDirectory();

    return fs
      .readdirSync(PACKAGE_DIR)
      .filter(file =>
        file.endsWith(".json")
      )
      .map(file =>
        safeReadJson(
          path.join(
            PACKAGE_DIR,
            file
          )
        )
      )
      .filter(Boolean)
      .sort((a, b) => {
        const priorityDifference =
          Number(b.priorityScore || 0) -
          Number(a.priorityScore || 0);

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        return String(
          b.createdAt || ""
        ).localeCompare(
          String(a.createdAt || "")
        );
      });
  }

  get(packageId) {
    if (!packageId) {
      return null;
    }

    const file = path.join(
      PACKAGE_DIR,
      `${packageId}.json`
    );

    if (!fs.existsSync(file)) {
      return null;
    }

    return safeReadJson(file);
  }

  update(packageId, patch = {}) {
    const current =
      this.get(packageId);

    if (!current) {
      throw new Error(
        `Work package not found: ${packageId}`
      );
    }

    const updated = {
      ...current,
      ...patch,
      id: current.id,
      signature:
        current.signature ||
        patch.signature,
      updatedAt:
        new Date().toISOString()
    };

    this.save(updated);

    return updated;
  }

  getStatus() {
    const packages = this.list();

    return {
      ok: true,
      root: ROOT,
      packageDirectory: PACKAGE_DIR,
      total: packages.length,
      active: packages.filter(item =>
        ACTIVE_STATUSES.has(
          normalizeStatus(item.status)
        )
      ).length,
      awaitingApproval:
        packages.filter(
          item =>
            normalizeStatus(item.status) ===
            "AWAITING_APPROVAL"
        ).length
    };
  }
}

module.exports =
  new WorkPackageService();