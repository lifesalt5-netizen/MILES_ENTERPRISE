"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class EmailInfrastructureManager {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS email_provisioning_queue (
        id TEXT PRIMARY KEY,
        domain TEXT,
        requestedEmail TEXT,
        provider TEXT,
        status TEXT,
        requiresKevin INTEGER,
        reason TEXT,
        payload TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )
    `).run();
  }

  now() {
    return new Date().toISOString();
  }

  getInventory() {
    const domains = this.store.getDomains();
    const inboxes = this.store.getInboxes();
    const usable = this.store.getUsableInboxes();

    return {
      domains,
      inboxes,
      usable,
      totalDomains: domains.length,
      activeDomains: domains.filter(d => d.status === "ACTIVE").length,
      totalInboxes: inboxes.length,
      usableInboxes: usable.length,
      dailyCapacity: usable.reduce((sum, i) => sum + Number(i.dailyLimit || 0), 0)
    };
  }

  buildGapAnalysis(targetInboxesPerDomain = 5) {
    const inventory = this.getInventory();
    const activeDomains = inventory.domains.filter(d =>
      d.status === "ACTIVE" &&
      String(d.domain).toLowerCase() !== "pathways2gc.com"
    );

    const gaps = [];

    for (const domain of activeDomains) {
      const domainInboxes = inventory.inboxes.filter(i =>
        String(i.domain).toLowerCase() === String(domain.domain).toLowerCase()
      );

      const needed = Math.max(0, targetInboxesPerDomain - domainInboxes.length);

      gaps.push({
        domain: domain.domain,
        existingInboxes: domainInboxes.length,
        targetInboxes: targetInboxesPerDomain,
        needed,
        currentCapacity: domainInboxes.reduce((sum, i) => sum + Number(i.dailyLimit || 0), 0)
      });
    }

    return {
      inventory,
      targetInboxesPerDomain,
      totalNeeded: gaps.reduce((sum, g) => sum + g.needed, 0),
      gaps
    };
  }

  requestedEmailExists(email) {
    const row = this.db.prepare(`
      SELECT id
      FROM email_provisioning_queue
      WHERE requestedEmail=?
        AND status IN ('PENDING_APPROVAL','APPROVED','CREATED','CONNECTED','WARMING','ACTIVE')
      LIMIT 1
    `).get(email);

    return !!row || this.store.getInboxes().some(i =>
      String(i.email).toLowerCase() === String(email).toLowerCase()
    );
  }

  suggestMailboxNames(domain, count) {
    const prefixes = [
      "kevin", "info", "contact", "growth", "federal",
      "contracts", "hello", "team", "outreach", "partners"
    ];

    const suggestions = [];

    for (const prefix of prefixes) {
      const email = `${prefix}@${domain}`;
      if (!this.requestedEmailExists(email)) suggestions.push(email);
      if (suggestions.length >= count) break;
    }

    let n = 1;
    while (suggestions.length < count) {
      const email = `outreach${n}@${domain}`;
      if (!this.requestedEmailExists(email)) suggestions.push(email);
      n++;
    }

    return suggestions;
  }

  queueProvisioning(targetInboxesPerDomain = 5) {
    const analysis = this.buildGapAnalysis(targetInboxesPerDomain);
    const created = [];

    for (const gap of analysis.gaps) {
      if (gap.needed <= 0) continue;

      const emails = this.suggestMailboxNames(gap.domain, gap.needed);

      for (const email of emails) {
        const item = {
          id: this.store.id("EMAILPROV"),
          domain: gap.domain,
          requestedEmail: email,
          provider: "UNKNOWN_NEEDS_MAPPING",
          status: "PENDING_APPROVAL",
          requiresKevin: 1,
          reason: `Create mailbox to reach ${targetInboxesPerDomain} inboxes for ${gap.domain}.`,
          payload: {
            source: "EmailInfrastructureManager",
            existingInboxes: gap.existingInboxes,
            targetInboxes: gap.targetInboxes,
            currentCapacity: gap.currentCapacity
          },
          createdAt: this.now(),
          updatedAt: this.now()
        };

        this.db.prepare(`
          INSERT INTO email_provisioning_queue
          (id,domain,requestedEmail,provider,status,requiresKevin,reason,payload,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(
          item.id,
          item.domain,
          item.requestedEmail,
          item.provider,
          item.status,
          item.requiresKevin,
          item.reason,
          JSON.stringify(item.payload),
          item.createdAt,
          item.updatedAt
        );

        created.push(item);
      }
    }

    this.store.insertEvent("EMAIL_PROVISIONING_QUEUE_CREATED", "Infrastructure", {
      created: created.length,
      targetInboxesPerDomain
    });

    return {
      analysis,
      created
    };
  }
}

module.exports = EmailInfrastructureManager;
