const fs = require("fs");
const path = require("path");
const planner = require("./PlannerService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const PACKAGE_DIR = path.join(ROOT, "DATA", "work_packages");

function id() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `WP-${stamp}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

class WorkPackageService {
  create(objective, context = {}) {
    fs.mkdirSync(PACKAGE_DIR, { recursive: true });

    const plan = planner.createPlan(objective, context);
    const workPackage = {
      id: id(),
      objective,
      status: plan.approvalRequired ? "AWAITING_APPROVAL" : "QUEUED",
      owner: "MILES",
      priority: plan.priority,
      priorityScore: plan.priorityScore,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan,
      tasks: plan.steps,
      approvals: plan.approvalRequired ? [{
        required: true,
        reason: "CEO approval required by planning rules.",
        status: "PENDING"
      }] : [],
      results: [],
      verification: {
        required: true,
        status: "PENDING"
      }
    };

    this.save(workPackage);
    return workPackage;
  }

  save(workPackage) {
    fs.mkdirSync(PACKAGE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PACKAGE_DIR, `${workPackage.id}.json`),
      JSON.stringify(workPackage, null, 2)
    );
  }

  list() {
    if (!fs.existsSync(PACKAGE_DIR)) return [];
    return fs.readdirSync(PACKAGE_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, f), "utf8")))
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  }

  get(packageId) {
    const file = path.join(PACKAGE_DIR, `${packageId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  update(packageId, patch = {}) {
    const current = this.get(packageId);
    if (!current) throw new Error(`Work package not found: ${packageId}`);

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.save(updated);
    return updated;
  }
}

module.exports = new WorkPackageService();
