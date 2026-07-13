"use strict";

const store = require("../../CORE/CANONICAL/EnterpriseStore");

const domains = [
  {
    id: "pathwaysgovcon_com",
    domain: "pathwaysgovcon.com",
    status: "ACTIVE",
    healthScore: 100,
    purpose: "Primary outbound domain",
    dailyCapacity: 125,
    notes: "Cora, Evan, Maya, Silvia, Victoria"
  },
  {
    id: "pathwaysgsa_com",
    domain: "pathwaysgsa.com",
    status: "ACTIVE",
    healthScore: 100,
    purpose: "GSA outbound domain",
    dailyCapacity: 60,
    notes: "contacts, info, kevin"
  },
  {
    id: "pathwaysgov_com",
    domain: "pathwaysgov.com",
    status: "ACTIVE",
    healthScore: 100,
    purpose: "Government outbound domain",
    dailyCapacity: 20,
    notes: "kevin"
  },
  {
    id: "pathways2gc_com",
    domain: "pathways2gc.com",
    status: "WEBSITE_ONLY",
    healthScore: 100,
    purpose: "Website/admin only",
    dailyCapacity: 0,
    notes: "Do not use for Instantly outbound"
  }
];

const inboxes = [
  { id: "cora_pathwaysgovcon", email: "cora@pathwaysgovcon.com", domain: "pathwaysgovcon.com", status: "ACTIVE", dailyLimit: 25 },
  { id: "evan_pathwaysgovcon", email: "evan@pathwaysgovcon.com", domain: "pathwaysgovcon.com", status: "ACTIVE", dailyLimit: 25 },
  { id: "maya_pathwaysgovcon", email: "maya@pathwaysgovcon.com", domain: "pathwaysgovcon.com", status: "ACTIVE", dailyLimit: 25 },
  { id: "silvia_pathwaysgovcon", email: "silvia@pathwaysgovcon.com", domain: "pathwaysgovcon.com", status: "ACTIVE", dailyLimit: 25 },
  { id: "victoria_pathwaysgovcon", email: "victoria@pathwaysgovcon.com", domain: "pathwaysgovcon.com", status: "ACTIVE", dailyLimit: 25 },

  { id: "contacts_pathwaysgsa", email: "contacts@pathwaysgsa.com", domain: "pathwaysgsa.com", status: "ACTIVE", dailyLimit: 20 },
  { id: "info_pathwaysgsa", email: "info@pathwaysgsa.com", domain: "pathwaysgsa.com", status: "ACTIVE", dailyLimit: 20 },
  { id: "kevin_pathwaysgsa", email: "kevin@pathwaysgsa.com", domain: "pathwaysgsa.com", status: "ACTIVE", dailyLimit: 20 },

  { id: "kevin_pathwaysgov", email: "kevin@pathwaysgov.com", domain: "pathwaysgov.com", status: "ACTIVE", dailyLimit: 20 },

  { id: "info_pathways2gc", email: "info@pathways2gc.com", domain: "pathways2gc.com", status: "ADMIN_ONLY", dailyLimit: 0 }
];

function ensureTables() {
  if (store.mode !== "sqlite") {
    throw new Error("SQLite mode required for DomainInboxImporter.");
  }

  store.db.prepare(`
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      domain TEXT,
      status TEXT,
      healthScore INTEGER,
      payload TEXT,
      updatedAt TEXT
    )
  `).run();

  store.db.prepare(`
    CREATE TABLE IF NOT EXISTS inboxes (
      id TEXT PRIMARY KEY,
      email TEXT,
      domain TEXT,
      status TEXT,
      dailyLimit INTEGER,
      payload TEXT,
      updatedAt TEXT
    )
  `).run();
}

function importDomainsAndInboxes() {
  ensureTables();

  const updatedAt = new Date().toISOString();

  for (const d of domains) {
    store.db.prepare(`
      INSERT OR REPLACE INTO domains
      (id, domain, status, healthScore, payload, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      d.id,
      d.domain,
      d.status,
      d.healthScore,
      JSON.stringify(d),
      updatedAt
    );
  }

  for (const i of inboxes) {
    store.db.prepare(`
      INSERT OR REPLACE INTO inboxes
      (id, email, domain, status, dailyLimit, payload, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      i.id,
      i.email,
      i.domain,
      i.status,
      i.dailyLimit,
      JSON.stringify(i),
      updatedAt
    );
  }

  store.insertEvent("DOMAINS_AND_INBOXES_IMPORTED", "Marketing", {
    domains: domains.length,
    inboxes: inboxes.length,
    activeInboxCapacity: inboxes
      .filter(i => i.status === "ACTIVE")
      .reduce((n, i) => n + i.dailyLimit, 0)
  });

  return {
    generatedAt: updatedAt,
    domainsImported: domains.length,
    inboxesImported: inboxes.length,
    activeInboxCapacity: inboxes
      .filter(i => i.status === "ACTIVE")
      .reduce((n, i) => n + i.dailyLimit, 0),
    domains,
    inboxes,
    storeStats: store.stats()
  };
}

module.exports = {
  importDomainsAndInboxes
};
