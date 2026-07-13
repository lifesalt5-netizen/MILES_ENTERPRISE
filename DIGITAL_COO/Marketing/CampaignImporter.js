"use strict";

const store = require("../../CORE/CANONICAL/EnterpriseStore");

async function importCampaigns() {
  let instantly;

  try {
    instantly = require("../../CONNECTORS/INSTANTLY/instantly");
  } catch (err) {
    store.insertEvent("INSTANTLY_IMPORT_FAILED", "Marketing", {
      error: err.message
    });
    throw err;
  }

  const response = await instantly.listCampaigns();
  const campaigns = response.items || [];

  for (const c of campaigns) {
    store.upsertCampaign({
      id: c.id,
      name: c.name,
      status: String(c.status),
      dailyLimit: c.daily_limit || 0,
      instantlyStatus: c.status,
      organization: c.organization,
      owner: c.owned_by,
      created: c.timestamp_created,
      updated: c.timestamp_updated,
      raw: c
    });
  }

  store.insertEvent("INSTANTLY_CAMPAIGNS_IMPORTED", "Marketing", {
    imported: campaigns.length,
    active: campaigns.filter(c => c.status === 1).length,
    paused: campaigns.filter(c => c.status !== 1).length
  });

  return {
    imported: campaigns.length,
    active: campaigns.filter(c => c.status === 1).length,
    paused: campaigns.filter(c => c.status !== 1).length,
    campaigns: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      dailyLimit: c.daily_limit || 0
    })),
    storeStats: store.stats()
  };
}

module.exports = {
  importCampaigns
};
