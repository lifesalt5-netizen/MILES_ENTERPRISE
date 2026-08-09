"use strict";

const ProspectGrowthAssessmentService = require("../SERVICES/revenue/ProspectGrowthAssessmentService");

const calls = [];

const mockOrion = {
    initialize() {
        return { ok: true, status: "INITIALIZED" };
    },

    searchContractors(term, limit) {
        calls.push({ type: "search", term, limit });
        return [
            {
                id: 42,
                company: "ACME FEDERAL LLC",
                company_norm: "ACME FEDERAL",
                uei: "ACMEUEI12345",
                federal_revenue: 125000,
                award_count: 3,
                vehicle: "GSA",
                vehicle_hint: "",
                segment: "GROWTH_VENDOR",
                primary_naics: "541512",
                all_matched_naics: "541512,541519",
                small_business_flag: "Y",
                industry_segment: "IT",
                market_priority: "TOP_MARKET",
                lead_score: 90,
                city: "TAMPA",
                state: "FL",
                entity_status: "A",
                registration_date: "20250101",
                expiration_date: "20270101",
                last_updated: "20260801"
            }
        ];
    },

    query(sql, params) {
        calls.push({ type: "query", sql, params });

        if (sql.includes("contractor_recommendations_v2")) {
            return [{
                contractor_id: 42,
                top_priority_actions: '["Use revenue leakage estimate as the commercial pain point"]',
                vehicle_recommendations: '["Expand vehicle utilization"]',
                certification_recommendations: '[]',
                buyer_recommendations: '["Diversify buyer base"]',
                opportunity_recommendations: '["Screen linked opportunities"]',
                partner_recommendations: '["Identify teaming partners"]',
                growth_recommendations: '["Prioritize recompete signals"]',
                last_updated: "2026-08-01"
            }];
        }

        if (sql.includes("persona_scores")) {
            return [{
                contractor_id: 42,
                primary_persona: "Underutilized GSA Contractor",
                secondary_persona: "Plateau Contractor",
                persona_score: 85,
                gsa_underutilized_score: 85,
                va_underutilized_score: 25,
                plateau_score: 60,
                agency_concentration_score: 50,
                recompete_risk_score: 40,
                vehicle_gap_score: 55,
                setaside_dependency_score: 20,
                growth_expansion_score: 80,
                last_updated: "2026-08-01"
            }];
        }

        if (sql.includes("FROM buyers")) {
            return [{ company_id: 42, buyer_name: "Agency Buyer", agency: "Agency", award_count: 2, spend: 50000 }];
        }

        if (sql.includes("FROM opportunities")) {
            return [{ company_id: 42, source: "FORECAST", title: "Opportunity", status: "OPEN", due_date: "2026-10-01" }];
        }

        if (sql.includes("FROM recompetes")) {
            return [{ company_id: 42, title: "Recompete", agency: "Agency", recompete_date: "2027-01-01", value: 1000000 }];
        }

        throw new Error(`Unexpected SQL: ${sql}`);
    }
};

const service = new ProspectGrowthAssessmentService({ orion: mockOrion });
const result = service.build("ACMEUEI12345");

function assert(condition, message) {
    if (!condition) throw new Error(message);
    console.log("[PASS]", message);
}

assert(result.ok === true, "assessment succeeds");
assert(result.status === "ASSESSMENT_READY", "assessment status ready");
assert(result.company.contractorId === 42, "contractor selected by UEI");
assert(result.persona.primary === "Underutilized GSA Contractor", "persona assembled");
assert(result.recommendations.topPriorityActions.length === 1, "recommendation JSON parsed");
assert(result.buyerAlignment.length === 1, "buyers joined");
assert(result.linkedOpportunities.length === 1, "opportunities joined");
assert(result.recompeteSignals.length === 1, "recompetes joined");
assert(result.safety.databaseMode === "READ_ONLY", "read-only safety recorded");
assert(result.safety.writesEnabled === false, "writes disabled");
assert(result.safety.emailsSent === false, "no email sending");
assert(result.safety.campaignsChanged === false, "no campaign changes");

const joinedIds = calls
    .filter((call) => call.type === "query")
    .map((call) => call.params[0]);

assert(joinedIds.every((id) => id === 42), "all intelligence tables join on contractor id");

console.log("PROSPECT_GROWTH_ASSESSMENT_TEST_PASS 13/13");
