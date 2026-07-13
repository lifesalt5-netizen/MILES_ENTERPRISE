"use strict";

/**
 * BUSINESS STATE AGGREGATOR
 *
 * Purpose:
 * Build one normalized business state from every provider.
 *
 * Consumers:
 *  - ExecutiveIntelligenceService
 *  - COO Engine
 *  - Revenue Engine
 *  - Deal Engine
 */

class BusinessStateAggregator {

  constructor(providerStates = []) {
    this.providerStates = providerStates;
  }

  async build() {

    const business = {
      generatedAt: new Date().toISOString(),

      providers: [],

      leads: [],
      opportunities: [],
      deals: [],
      replies: [],
      campaigns: [],
      proposals: [],
      contractors: [],

      revenue: {
        pipelineValue: 0,
        expectedClose: 0,
        activeDeals: 0
      }
    };

    for (const provider of this.providerStates) {

      business.providers.push({
        provider: provider.provider,
        status: provider.status
      });

      if (Array.isArray(provider.leads))
        business.leads.push(...provider.leads);

      if (Array.isArray(provider.opportunities))
        business.opportunities.push(...provider.opportunities);

      if (Array.isArray(provider.deals))
        business.deals.push(...provider.deals);

      if (Array.isArray(provider.replies))
        business.replies.push(...provider.replies);

      if (Array.isArray(provider.campaigns))
        business.campaigns.push(...provider.campaigns);

      if (Array.isArray(provider.proposals))
        business.proposals.push(...provider.proposals);

      if (Array.isArray(provider.contractors))
        business.contractors.push(...provider.contractors);
    }

    business.revenue.activeDeals =
      business.deals.length;

    business.revenue.pipelineValue =
      business.deals.reduce(
        (t, d) => t + Number(d.value || 0),
        0
      );

    business.revenue.expectedClose =
      business.deals.reduce(
        (t, d) =>
          t +
          (
            Number(d.value || 0) *
            Number(d.probability || 0)
          ),
        0
      );

    return business;
  }
}

module.exports = BusinessStateAggregator;