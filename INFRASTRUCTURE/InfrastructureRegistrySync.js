"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class InfrastructureRegistrySync {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS domain_registry (
        domain TEXT PRIMARY KEY,
        registrar TEXT,
        dnsProvider TEXT,
        mailProvider TEXT,
        role TEXT,
        outboundEnabled INTEGER,
        websiteOnly INTEGER,
        instantlyConnected INTEGER,
        targetInboxes INTEGER,
        currentInboxes INTEGER,
        usableInboxes INTEGER,
        dailyCapacity INTEGER,
        status TEXT,
        payload TEXT,
        updatedAt TEXT
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS mailbox_registry (
        email TEXT PRIMARY KEY,
        domain TEXT,
        provider TEXT,
        instantlyConnected INTEGER,
        warmupEnabled INTEGER,
        healthScore INTEGER,
        dailyLimit INTEGER,
        status TEXT,
        payload TEXT,
        updatedAt TEXT
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS mailbox_policy (
        key TEXT PRIMARY KEY,
        value TEXT,
        updatedAt TEXT
      )
    `).run();
  }

  seedMailboxPolicy() {
    const policy = {
      reserved: ["info", "contact", "support", "admin", "billing", "hello", "webmaster"],
      preferredOutbound: ["cora", "evan", "maya", "silvia", "victoria"],
      targetInboxesPerOutboundDomain: 5
    };

    this.db.prepare(`
      INSERT OR REPLACE INTO mailbox_policy (key,value,updatedAt)
      VALUES (?,?,?)
    `).run("default", JSON.stringify(policy), this.now());

    return policy;
  }

  seedDomains() {
    const domains = [
      { domain: "pathwaysgovcon.com", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 1 },
      { domain: "pathwaysgov.com", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 1 },
      { domain: "pathwaysgsa.com", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 1 },
      { domain: "pathwaysfederal.com", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 0 },
      { domain: "pathwaystogc.com", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 0 },
      { domain: "pathways2gc.co", registrar: "Namecheap", dnsProvider: "Namecheap", mailProvider: "Google Workspace", role: "OUTBOUND", outboundEnabled: 1, websiteOnly: 0, instantlyConnected: 0 },
      { domain: "pathways2gc.com", registrar: "IONOS/Namecheap", dnsProvider: "IONOS", mailProvider: "IONOS", role: "WEBSITE_ADMIN", outboundEnabled: 0, websiteOnly: 1, instantlyConnected: 0 }
    ];

    for (const d of domains) {
      this.db.prepare(`
        INSERT OR REPLACE INTO domain_registry
        (domain,registrar,dnsProvider,mailProvider,role,outboundEnabled,websiteOnly,instantlyConnected,targetInboxes,currentInboxes,usableInboxes,dailyCapacity,status,payload,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        d.domain,
        d.registrar,
        d.dnsProvider,
        d.mailProvider,
        d.role,
        d.outboundEnabled,
        d.websiteOnly,
        d.instantlyConnected,
        5,
        0,
        0,
        0,
        d.outboundEnabled ? "ACTIVE" : "WEBSITE_ONLY",
        JSON.stringify(d),
        this.now()
      );
    }

    return domains;
  }

  seedInstantlyMailboxes() {
    const mailboxes = [
      { email: "contacts@pathwaysgsa.com", warmup: 30, health: 100, dailyLimit: 30 },
      { email: "cora@pathwaysgovcon.com", warmup: 57, health: 98, dailyLimit: 25 },
      { email: "evan@pathwaysgovcon.com", warmup: 57, health: 100, dailyLimit: 25 },
      { email: "info@pathways2gc.com", warmup: 0, health: 0, dailyLimit: 0, status: "ADMIN_ONLY" },
      { email: "info@pathwaysgsa.com", warmup: 30, health: 100, dailyLimit: 30 },
      { email: "kevin@pathwaysgov.com", warmup: 30, health: 100, dailyLimit: 20 },
      { email: "kevin@pathwaysgsa.com", warmup: 30, health: 100, dailyLimit: 30 },
      { email: "maya@pathwaysgovcon.com", warmup: 57, health: 100, dailyLimit: 25 },
      { email: "silvia@pathwaysgovcon.com", warmup: 57, health: 100, dailyLimit: 25 },
      { email: "victoria@pathwaysgovcon.com", warmup: 57, health: 100, dailyLimit: 25 }
    ];

    for (const m of mailboxes) {
      const domain = m.email.split("@")[1];
      const adminOnly = domain === "pathways2gc.com" || m.status === "ADMIN_ONLY";
      const status = adminOnly ? "ADMIN_ONLY" : "ACTIVE";

      this.db.prepare(`
        INSERT OR REPLACE INTO mailbox_registry
        (email,domain,provider,instantlyConnected,warmupEnabled,healthScore,dailyLimit,status,payload,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        m.email,
        domain,
        "Instantly",
        adminOnly ? 0 : 1,
        adminOnly ? 0 : 1,
        m.health,
        m.dailyLimit,
        status,
        JSON.stringify(m),
        this.now()
      );
    }

    return mailboxes;
  }

  updateDomainCounts() {
    const domains = this.db.prepare("SELECT domain FROM domain_registry").all();

    for (const d of domains) {
      const rows = this.db.prepare("SELECT * FROM mailbox_registry WHERE domain=?").all(d.domain);
      const usable = rows.filter(r => r.status === "ACTIVE" && r.instantlyConnected === 1);
      const capacity = usable.reduce((sum, r) => sum + Number(r.dailyLimit || 0), 0);

      this.db.prepare(`
        UPDATE domain_registry
        SET currentInboxes=?, usableInboxes=?, dailyCapacity=?, updatedAt=?
        WHERE domain=?
      `).run(rows.length, usable.length, capacity, this.now(), d.domain);
    }
  }

  provisioningPlan() {
    const policy = JSON.parse(this.db.prepare("SELECT value FROM mailbox_policy WHERE key='default'").get().value);
    const domains = this.db.prepare(`
      SELECT *
      FROM domain_registry
      WHERE outboundEnabled=1 AND websiteOnly=0
      ORDER BY domain ASC
    `).all();

    const existing = new Set(
      this.db.prepare("SELECT email FROM mailbox_registry").all().map(r => r.email.toLowerCase())
    );

    const plan = [];

    for (const d of domains) {
      const needed = Math.max(0, Number(d.targetInboxes || policy.targetInboxesPerOutboundDomain) - Number(d.currentInboxes || 0));
      const candidates = [];

      for (const prefix of policy.preferredOutbound) {
        const email = `${prefix}@${d.domain}`.toLowerCase();
        if (!existing.has(email)) candidates.push(email);
        if (candidates.length >= needed) break;
      }

      plan.push({
        domain: d.domain,
        instantlyConnected: d.instantlyConnected,
        currentInboxes: d.currentInboxes,
        usableInboxes: d.usableInboxes,
        targetInboxes: d.targetInboxes,
        dailyCapacity: d.dailyCapacity,
        needed,
        suggestedEmails: candidates
      });
    }

    return plan;
  }

  run() {
    const policy = this.seedMailboxPolicy();
    const domains = this.seedDomains();
    const mailboxes = this.seedInstantlyMailboxes();
    this.updateDomainCounts();
    const plan = this.provisioningPlan();

    this.store.insertEvent("INFRASTRUCTURE_REGISTRY_SYNC_COMPLETED", "Infrastructure", {
      domains: domains.length,
      mailboxes: mailboxes.length,
      provisioningNeeded: plan.reduce((sum, p) => sum + p.needed, 0)
    });

    return { policy, domains, mailboxes, plan };
  }
}

module.exports = InfrastructureRegistrySync;
