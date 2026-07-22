"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();
const DB_DIR = path.join(ROOT, "DATA", "enterprise_db");
const DB_FILE = path.join(DB_DIR, "Enterprise.db");
const FALLBACK_FILE = path.join(DB_DIR, "enterprise_store.json");

function now() {
  return new Date().toISOString();
}

function ensureDir() {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function parseJson(value, fallback = {}) {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  } catch {
    return fallback;
  }
}

class EnterpriseStore {
  constructor() {
    ensureDir();
    this.mode = "json";
    this.db = null;
    this.json = this.loadJson();

    try {
      const Database = require("better-sqlite3");
      this.db = new Database(DB_FILE);
      this.mode = "sqlite";
      this.initSqlite();
    } catch {
      this.mode = "json";
      this.initJson();
    }
  }

  id(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 99999)}`;
  }

  loadJson() {
    try {
      if (!fs.existsSync(FALLBACK_FILE)) return {};
      return JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  saveJson() {
    ensureDir();
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(this.json, null, 2), "utf8");
  }

  initJson() {
    for (const table of [
      "events","tasks","segments","campaigns","domains","inboxes","approvals","settings",
      "marketingCapacityPlans","marketingCapacityAllocations","marketingUploadQueue","marketingUploadQueueRuns","marketingLeadUploadHistory"
    ]) {
      if (!Array.isArray(this.json[table])) this.json[table] = [];
    }
    this.saveJson();
  }

  initSqlite() {
    const sql = [
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT,
        department TEXT,
        payload TEXT,
        createdAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        department TEXT,
        title TEXT,
        status TEXT,
        priority INTEGER,
        requiresKevin INTEGER,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        file TEXT,
        exactRows INTEGER,
        verified INTEGER,
        readyForUpload INTEGER,
        assignedCampaign TEXT,
        uploadStatus TEXT,
        nextAction TEXT,
        payload TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT,
        dailyLimit INTEGER,
        payload TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        domain TEXT,
        status TEXT,
        healthScore INTEGER,
        payload TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS inboxes (
        id TEXT PRIMARY KEY,
        email TEXT,
        domain TEXT,
        status TEXT,
        dailyLimit INTEGER,
        payload TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        department TEXT,
        title TEXT,
        status TEXT,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS marketing_capacity_plans (
        id TEXT PRIMARY KEY,
        planDate TEXT,
        totalDailyCapacity INTEGER,
        usableDailyCapacity INTEGER,
        reservedSafetyCapacity INTEGER,
        activeCampaigns INTEGER,
        pausedCampaigns INTEGER,
        readySegments INTEGER,
        needsReviewSegments INTEGER,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS marketing_capacity_allocations (
        id TEXT PRIMARY KEY,
        planId TEXT,
        campaignId TEXT,
        campaignName TEXT,
        domain TEXT,
        inboxCount INTEGER,
        assignedDailyCapacity INTEGER,
        recommendedUploadCount INTEGER,
        status TEXT,
        reason TEXT,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS marketing_upload_queue (
        id TEXT PRIMARY KEY,
        segmentId TEXT,
        segmentName TEXT,
        campaignId TEXT,
        campaignName TEXT,
        domain TEXT,
        requestedUploadCount INTEGER,
        approvedUploadCount INTEGER,
        status TEXT,
        priority INTEGER,
        requiresKevin INTEGER,
        approvalId TEXT,
        reason TEXT,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS marketing_lead_upload_history (
    id TEXT PRIMARY KEY,
    email TEXT,
    company TEXT,
    segmentId TEXT,
    campaignId TEXT,
    instantlyLeadId TEXT,
    status TEXT,
    uploadedAt TEXT
  );

      CREATE TABLE IF NOT EXISTS marketing_lead_upload_history (
    id TEXT PRIMARY KEY,
    email TEXT,
    company TEXT,
    segmentId TEXT,
    campaignId TEXT,
    instantlyLeadId TEXT,
    status TEXT,
    uploadedAt TEXT
  );


      CREATE TABLE IF NOT EXISTS marketing_upload_queue_runs (
        id TEXT PRIMARY KEY,
        queuedItems INTEGER,
        skippedItems INTEGER,
        payload TEXT,
        createdAt TEXT
      )`
    ];

    for (const statement of sql) this.db.prepare(statement).run();
  }

  insertEvent(type, department, payload = {}) {
    const item = { id: this.id("EVT"), type, department, payload, createdAt: now() };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT INTO events (id,type,department,payload,createdAt) VALUES (?,?,?,?,?)"
      ).run(item.id, item.type, item.department, JSON.stringify(item.payload), item.createdAt);
    } else {
      this.json.events.push(item);
      this.saveJson();
    }

    return item;
  }

  addTask(task = {}) {
    const item = {
      id: task.id || this.id("TASK"),
      department: task.department || "General",
      title: task.title || "Untitled task",
      status: task.status || "READY",
      priority: Number(task.priority || 3),
      requiresKevin: task.requiresKevin ? 1 : 0,
      payload: task.payload || {},
      createdAt: task.createdAt || now(),
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        `INSERT OR REPLACE INTO tasks
        (id,department,title,status,priority,requiresKevin,payload,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(item.id,item.department,item.title,item.status,item.priority,item.requiresKevin,JSON.stringify(item.payload),item.createdAt,item.updatedAt);
    } else {
      this.json.tasks = this.json.tasks.filter(x => x.id !== item.id);
      this.json.tasks.push(item);
      this.saveJson();
    }

    return item;
  }

  upsertSegment(segment = {}) {
    const id = segment.id || String(segment.name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

    const item = {
      id,
      name: segment.name || id,
      category: segment.category || "GENERAL",
      file: segment.file || null,
      exactRows: Number(segment.exactRows || segment.rows || segment.leadCount || 0),
      verified: segment.verified ? 1 : 0,
      readyForUpload: segment.readyForUpload ? 1 : 0,
      assignedCampaign: segment.assignedCampaign || null,
      uploadStatus: segment.uploadStatus || "UNKNOWN",
      nextAction: segment.nextAction || null,
      payload: segment,
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        `INSERT OR REPLACE INTO segments
        (id,name,category,file,exactRows,verified,readyForUpload,assignedCampaign,uploadStatus,nextAction,payload,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(item.id,item.name,item.category,item.file,item.exactRows,item.verified,item.readyForUpload,item.assignedCampaign,item.uploadStatus,item.nextAction,JSON.stringify(item.payload),item.updatedAt);
    } else {
      this.json.segments = this.json.segments.filter(x => x.id !== item.id);
      this.json.segments.push(item);
      this.saveJson();
    }

    return item;
  }

  getSegments() {
    if (this.mode === "sqlite") {
      return this.db.prepare("SELECT * FROM segments ORDER BY name ASC").all()
        .map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }
    return this.json.segments || [];
  }

  getReadySegments() {
    return this.getSegments().filter(x =>
      x.readyForUpload === 1 ||
      String(x.uploadStatus || "").toUpperCase().includes("READY")
    );
  }

  upsertCampaign(campaign = {}) {
    const id = campaign.id || String(campaign.name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

    const item = {
      id,
      name: campaign.name || id,
      status: String(campaign.status || "UNKNOWN"),
      dailyLimit: Number(campaign.dailyLimit || campaign.daily_limit || 0),
      payload: campaign,
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT OR REPLACE INTO campaigns (id,name,status,dailyLimit,payload,updatedAt) VALUES (?,?,?,?,?,?)"
      ).run(item.id,item.name,item.status,item.dailyLimit,JSON.stringify(item.payload),item.updatedAt);
    } else {
      this.json.campaigns = this.json.campaigns.filter(x => x.id !== item.id);
      this.json.campaigns.push(item);
      this.saveJson();
    }

    return item;
  }

  getCampaigns() {
    if (this.mode === "sqlite") {
      return this.db.prepare("SELECT * FROM campaigns ORDER BY name ASC").all()
        .map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }
    return this.json.campaigns || [];
  }

  getActiveCampaigns() {
    return this.getCampaigns().filter(x => String(x.status || "").toUpperCase() === "ACTIVE");
  }

  upsertDomain(domain = {}) {
    const id = domain.id || String(domain.domain || "").toLowerCase();

    const item = {
      id,
      domain: domain.domain || id,
      status: domain.status || "UNKNOWN",
      healthScore: Number(domain.healthScore || domain.health_score || 0),
      payload: domain,
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT OR REPLACE INTO domains (id,domain,status,healthScore,payload,updatedAt) VALUES (?,?,?,?,?,?)"
      ).run(item.id,item.domain,item.status,item.healthScore,JSON.stringify(item.payload),item.updatedAt);
    } else {
      this.json.domains = this.json.domains.filter(x => x.id !== item.id);
      this.json.domains.push(item);
      this.saveJson();
    }

    return item;
  }

  getDomains() {
    if (this.mode === "sqlite") {
      return this.db.prepare("SELECT * FROM domains ORDER BY domain ASC").all()
        .map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }
    return this.json.domains || [];
  }

  upsertInbox(inbox = {}) {
    const id = inbox.id || String(inbox.email || "").toLowerCase();

    const item = {
      id,
      email: inbox.email || id,
      domain: inbox.domain || String(inbox.email || "").split("@")[1] || null,
      status: inbox.status || "UNKNOWN",
      dailyLimit: Number(inbox.dailyLimit || inbox.daily_limit || inbox.dailyCapacity || 0),
      payload: inbox,
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT OR REPLACE INTO inboxes (id,email,domain,status,dailyLimit,payload,updatedAt) VALUES (?,?,?,?,?,?,?)"
      ).run(item.id,item.email,item.domain,item.status,item.dailyLimit,JSON.stringify(item.payload),item.updatedAt);
    } else {
      this.json.inboxes = this.json.inboxes.filter(x => x.id !== item.id);
      this.json.inboxes.push(item);
      this.saveJson();
    }

    return item;
  }

  getInboxes() {
    if (this.mode === "sqlite") {
      return this.db.prepare("SELECT * FROM inboxes ORDER BY domain ASC,email ASC").all()
        .map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }
    return this.json.inboxes || [];
  }

  getUsableInboxes() {
    return this.getInboxes().filter(x => {
      const domain = String(x.domain || "").toLowerCase();
      const status = String(x.status || "").toUpperCase();
      return domain !== "pathways2gc.com" &&
        !["DISABLED","INACTIVE","ADMIN_ONLY","WEBSITE_ONLY"].includes(status);
    });
  }

  createApproval(approval = {}) {
    const item = {
      id: approval.id || this.id("APPROVAL"),
      department: approval.department || "Marketing",
      title: approval.title || "Approval required",
      status: approval.status || "PENDING",
      payload: approval.payload || {},
      createdAt: approval.createdAt || now(),
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT OR REPLACE INTO approvals (id,department,title,status,payload,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)"
      ).run(item.id,item.department,item.title,item.status,JSON.stringify(item.payload),item.createdAt,item.updatedAt);
    } else {
      this.json.approvals = this.json.approvals.filter(x => x.id !== item.id);
      this.json.approvals.push(item);
      this.saveJson();
    }

    this.insertEvent("APPROVAL_CREATED", item.department, item);
    return item;
  }

      getPendingApprovals(department = null) {
    if (this.mode === "sqlite") {
      const rows = department
        ? this.db.prepare(
            "SELECT * FROM approvals WHERE status='PENDING' AND department=? ORDER BY createdAt ASC"
          ).all(department)
        : this.db.prepare(
            "SELECT * FROM approvals WHERE status='PENDING' ORDER BY createdAt ASC"
          ).all();

      return rows.map(x =>
        Object.assign({}, x, {
          payload: parseJson(x.payload)
        })
      );
    }

    return (this.json.approvals || []).filter(
      x =>
        x.status === "PENDING" &&
        (!department || x.department === department)
    );
  }


  updateApproval(id, status) {
    const updatedAt = now();

    if (this.mode === "sqlite") {

      this.db.prepare(
        `
        UPDATE approvals
        SET status=?,
            updatedAt=?
        WHERE id=?
        `
      ).run(
        status,
        updatedAt,
        id
      );

    } else {

      const item =
        this.json.approvals.find(
          x => x.id === id
        );

      if (item) {
        item.status = status;
        item.updatedAt = updatedAt;
        this.saveJson();
      }
    }

    if (this.mode === "sqlite") {
  const row =
    this.db.prepare(
      "SELECT * FROM approvals WHERE id=?"
    ).get(id);

  return row
    ? Object.assign({}, row, {
        payload: parseJson(row.payload)
      })
    : null;
}

return (this.json.approvals || [])
  .find(x => x.id === id) || null;
  }


  updateUploadQueue(id, patch = {}) {

    const updatedAt = now();

    if (this.mode === "sqlite") {

      const current =
        this.db.prepare(
          "SELECT * FROM marketing_upload_queue WHERE id=?"
        ).get(id);

      if (!current) {
        return null;
      }

      this.db.prepare(
        `
        UPDATE marketing_upload_queue
        SET status=?,
            approvedUploadCount=?,
            updatedAt=?
        WHERE id=?
        `
      ).run(
        patch.status || current.status,
        patch.approvedUploadCount ?? current.approvedUploadCount,
        updatedAt,
        id
      );

    } else {

      const item =
        this.json.marketingUploadQueue.find(
          x => x.id === id
        );

      if (item) {
        Object.assign(item, patch);
        item.updatedAt = updatedAt;
        this.saveJson();
      }
    }

    return this.getUploadQueue()
      .find(x => x.id === id) || null;
  }


  createCapacityPlan(plan = {}) {
    const item = {
      id: plan.id || this.id("CAPACITY"),
      planDate: plan.planDate || now().slice(0, 10),
      totalDailyCapacity: Number(plan.totalDailyCapacity || 0),
      usableDailyCapacity: Number(plan.usableDailyCapacity || 0),
      reservedSafetyCapacity: Number(plan.reservedSafetyCapacity || 0),
      activeCampaigns: Number(plan.activeCampaigns || 0),
      pausedCampaigns: Number(plan.pausedCampaigns || 0),
      readySegments: Number(plan.readySegments || 0),
      needsReviewSegments: Number(plan.needsReviewSegments || 0),
      payload: plan.payload || plan,
      createdAt: plan.createdAt || now(),
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        `INSERT OR REPLACE INTO marketing_capacity_plans
        (id,planDate,totalDailyCapacity,usableDailyCapacity,reservedSafetyCapacity,activeCampaigns,pausedCampaigns,readySegments,needsReviewSegments,payload,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(item.id,item.planDate,item.totalDailyCapacity,item.usableDailyCapacity,item.reservedSafetyCapacity,item.activeCampaigns,item.pausedCampaigns,item.readySegments,item.needsReviewSegments,JSON.stringify(item.payload),item.createdAt,item.updatedAt);
    } else {
      this.json.marketingCapacityPlans = this.json.marketingCapacityPlans.filter(x => x.id !== item.id);
      this.json.marketingCapacityPlans.push(item);
      this.saveJson();
    }

    this.insertEvent("MARKETING_CAPACITY_PLAN_CREATED", "Marketing", item);
    return item;
  }

  getLatestCapacityPlan() {
    if (this.mode === "sqlite") {
      const row = this.db.prepare("SELECT * FROM marketing_capacity_plans ORDER BY createdAt DESC LIMIT 1").get();
      return row ? Object.assign({}, row, { payload: parseJson(row.payload) }) : null;
    }

    return [...(this.json.marketingCapacityPlans || [])].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }

  createCapacityAllocation(allocation = {}) {
    const item = {
      id: allocation.id || this.id("ALLOC"),
      planId: allocation.planId,
      campaignId: allocation.campaignId,
      campaignName: allocation.campaignName || null,
      domain: allocation.domain || null,
      inboxCount: Number(allocation.inboxCount || 0),
      assignedDailyCapacity: Number(allocation.assignedDailyCapacity || 0),
      recommendedUploadCount: Number(allocation.recommendedUploadCount || 0),
      status: allocation.status || "PLANNED",
      reason: allocation.reason || null,
      payload: allocation.payload || allocation,
      createdAt: allocation.createdAt || now(),
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        `INSERT OR REPLACE INTO marketing_capacity_allocations
        (id,planId,campaignId,campaignName,domain,inboxCount,assignedDailyCapacity,recommendedUploadCount,status,reason,payload,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(item.id,item.planId,item.campaignId,item.campaignName,item.domain,item.inboxCount,item.assignedDailyCapacity,item.recommendedUploadCount,item.status,item.reason,JSON.stringify(item.payload),item.createdAt,item.updatedAt);
    } else {
      this.json.marketingCapacityAllocations = this.json.marketingCapacityAllocations.filter(x => x.id !== item.id);
      this.json.marketingCapacityAllocations.push(item);
      this.saveJson();
    }

    return item;
  }

  getCapacityAllocations(planId) {
    if (this.mode === "sqlite") {
      return this.db.prepare("SELECT * FROM marketing_capacity_allocations WHERE planId=? ORDER BY assignedDailyCapacity DESC").all(planId)
        .map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }

    return (this.json.marketingCapacityAllocations || []).filter(x => x.planId === planId);
  }

  createUploadQueueItem(item = {}) {
    const queueItem = {
      id: item.id || this.id("UPLOAD"),
      segmentId: item.segmentId,
      segmentName: item.segmentName || null,
      campaignId: item.campaignId,
      campaignName: item.campaignName || null,
      domain: item.domain || null,
      requestedUploadCount: Number(item.requestedUploadCount || 0),
      approvedUploadCount: Number(item.approvedUploadCount || 0),
      status: item.status || "PENDING_APPROVAL",
      priority: Number(item.priority || 50),
      requiresKevin: item.requiresKevin === undefined ? 1 : item.requiresKevin ? 1 : 0,
      approvalId: item.approvalId || null,
      reason: item.reason || null,
      payload: item.payload || item,
      createdAt: item.createdAt || now(),
      updatedAt: now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        `INSERT OR REPLACE INTO marketing_upload_queue
        (id,segmentId,segmentName,campaignId,campaignName,domain,requestedUploadCount,approvedUploadCount,status,priority,requiresKevin,approvalId,reason,payload,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(queueItem.id,queueItem.segmentId,queueItem.segmentName,queueItem.campaignId,queueItem.campaignName,queueItem.domain,queueItem.requestedUploadCount,queueItem.approvedUploadCount,queueItem.status,queueItem.priority,queueItem.requiresKevin,queueItem.approvalId,queueItem.reason,JSON.stringify(queueItem.payload),queueItem.createdAt,queueItem.updatedAt);
    } else {
      this.json.marketingUploadQueue = this.json.marketingUploadQueue.filter(x => x.id !== queueItem.id);
      this.json.marketingUploadQueue.push(queueItem);
      this.saveJson();
    }

    this.insertEvent("MARKETING_UPLOAD_QUEUE_ITEM_CREATED", "Marketing", queueItem);
    return queueItem;
  }

  getUploadQueue(status = null) {
    if (this.mode === "sqlite") {
      const rows = status
        ? this.db.prepare("SELECT * FROM marketing_upload_queue WHERE status=? ORDER BY priority ASC, createdAt ASC").all(status)
        : this.db.prepare("SELECT * FROM marketing_upload_queue ORDER BY priority ASC, createdAt ASC").all();

      return rows.map(x => Object.assign({}, x, { payload: parseJson(x.payload) }));
    }

    return (this.json.marketingUploadQueue || []).filter(x => !status || x.status === status);
  }

  createUploadQueueRun(run = {}) {
    const item = {
      id: run.id || this.id("UPLOADRUN"),
      queuedItems: Number(run.queuedItems || 0),
      skippedItems: Number(run.skippedItems || 0),
      payload: run.payload || run,
      createdAt: run.createdAt || now()
    };

    if (this.mode === "sqlite") {
      this.db.prepare(
        "INSERT OR REPLACE INTO marketing_upload_queue_runs (id,queuedItems,skippedItems,payload,createdAt) VALUES (?,?,?,?,?)"
      ).run(item.id,item.queuedItems,item.skippedItems,JSON.stringify(item.payload),item.createdAt);
    } else {
      this.json.marketingUploadQueueRuns.push(item);
      this.saveJson();
    }

    this.insertEvent("MARKETING_UPLOAD_QUEUE_RUN_CREATED", "Marketing", item);
    return item;
  }

  setSetting(key, value) {
    const updatedAt = now();

    if (this.mode === "sqlite") {
      this.db.prepare("INSERT OR REPLACE INTO settings (key,value,updatedAt) VALUES (?,?,?)")
        .run(key, JSON.stringify(value), updatedAt);
    } else {
      this.json.settings = this.json.settings.filter(x => x.key !== key);
      this.json.settings.push({ key, value, updatedAt });
      this.saveJson();
    }

    return { key, value, updatedAt };
  }

  getSetting(key, fallback = null) {
    if (this.mode === "sqlite") {
      const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key);
      return row ? parseJson(row.value, fallback) : fallback;
    }

    const row = (this.json.settings || []).find(x => x.key === key);
    return row ? row.value : fallback;
  }


  createLeadUploadHistory(item = {}) {

    const row = {
      id: item.id || this.id("LEADUPLOAD"),
      email:item.email,
      company:item.company || "",
      segmentId:item.segmentId || "",
      campaignId:item.campaignId || "",
      instantlyLeadId:item.instantlyLeadId || "",
      status:item.status || "UPLOADED",
      uploadedAt:item.uploadedAt || now()
    };


    this.db.prepare(
      `INSERT OR REPLACE INTO marketing_lead_upload_history
      (id,email,company,segmentId,campaignId,instantlyLeadId,status,uploadedAt)
      VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      row.id,
      row.email,
      row.company,
      row.segmentId,
      row.campaignId,
      row.instantlyLeadId,
      row.status,
      row.uploadedAt
    );


    return row;

  }


  getLeadUploadHistory() {

    return this.db.prepare(
      "SELECT * FROM marketing_lead_upload_history"
    ).all();

  }


  findLeadUpload(email,campaignId){

    return this.db.prepare(
      "SELECT * FROM marketing_lead_upload_history WHERE email=? AND campaignId=?"
    ).get(
      email,
      campaignId
    );

  }




  ensureMarketingLeadUploadHistory(){

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketing_lead_upload_history (
        id TEXT PRIMARY KEY,
        email TEXT,
        company TEXT,
        segmentId TEXT,
        campaignId TEXT,
        instantlyLeadId TEXT,
        status TEXT,
        uploadedAt TEXT
      );
    `);

  }


  count(table) {
    if (this.mode === "sqlite") {
      return this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }

    return Array.isArray(this.json[table]) ? this.json[table].length : 0;
  }

  stats() {
    return {
      mode: this.mode,
      root: ROOT,
      dbFile: DB_FILE,
      counts: {
        events: this.count("events"),
        tasks: this.count("tasks"),
        segments: this.count("segments"),
        campaigns: this.count("campaigns"),
        domains: this.count("domains"),
        inboxes: this.count("inboxes"),
        approvals: this.count("approvals"),
        settings: this.count("settings"),
        marketing_capacity_plans: this.count("marketing_capacity_plans"),
        marketing_capacity_allocations: this.count("marketing_capacity_allocations"),
        marketing_upload_queue: this.count("marketing_upload_queue"),
        marketing_upload_queue_runs: this.count("marketing_upload_queue_runs")
      }
    };
  }
}

module.exports = new EnterpriseStore();




