"use strict";

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === "") return [];

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            return [value];
        }
    }

    return [value];
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

class ProspectGrowthAssessmentService {
    constructor(options = {}) {
        this.orion = options.orion || null;
    }

    getOrion() {
        if (!this.orion) {
            this.orion = require("../../CONNECTORS/ORION/connector");
        }

        return this.orion;
    }

    selectContractor(term, candidates = []) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return null;
        }

        const raw = String(term || "").trim();
        const normalized = normalizeText(raw);

        const exactUei = candidates.find(
            (row) => String(row?.uei || "").trim().toUpperCase() === raw.toUpperCase()
        );

        if (exactUei) return exactUei;

        const exactCompany = candidates.find(
            (row) =>
                normalizeText(row?.company) === normalized ||
                normalizeText(row?.company_norm) === normalized
        );

        return exactCompany || candidates[0];
    }

    build(term, options = {}) {
        const searchTerm = String(term || "").trim();

        if (!searchTerm) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "TERM_REQUIRED",
                readOnly: true
            };
        }

        const orion = this.getOrion();
        const init = orion.initialize();

        if (!init?.ok) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "ORION_UNAVAILABLE",
                error: init?.message || "ORION initialization failed.",
                readOnly: true
            };
        }

        const candidates = orion.searchContractors(
            searchTerm,
            Math.max(1, Math.min(Number(options.searchLimit) || 10, 50))
        );

        const contractor = this.selectContractor(searchTerm, candidates);

        if (!contractor) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "CONTRACTOR_NOT_FOUND",
                term: searchTerm,
                candidates: [],
                readOnly: true
            };
        }

        const contractorId = contractor.id;
        const detailLimit = Math.max(1, Math.min(Number(options.detailLimit) || 25, 100));

        const recommendationRows = orion.query(
            "SELECT * FROM contractor_recommendations_v2 WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        );

        const personaRows = orion.query(
            "SELECT * FROM persona_scores WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        );

        const buyers = orion.query(
            "SELECT * FROM buyers WHERE company_id = ? ORDER BY spend DESC, award_count DESC LIMIT ?",
            [contractorId, detailLimit]
        );

        const opportunities = orion.query(
            "SELECT * FROM opportunities WHERE company_id = ? ORDER BY CASE WHEN due_date = '' OR due_date IS NULL THEN 1 ELSE 0 END, due_date ASC LIMIT ?",
            [contractorId, detailLimit]
        );

        const recompetes = orion.query(
            "SELECT * FROM recompetes WHERE company_id = ? ORDER BY CASE WHEN recompete_date = '' OR recompete_date IS NULL THEN 1 ELSE 0 END, recompete_date ASC LIMIT ?",
            [contractorId, detailLimit]
        );

        const recommendation = recommendationRows[0] || null;
        const persona = personaRows[0] || null;

        const recommendations = recommendation
            ? {
                topPriorityActions: parseJsonArray(recommendation.top_priority_actions),
                vehicle: parseJsonArray(recommendation.vehicle_recommendations),
                certification: parseJsonArray(recommendation.certification_recommendations),
                buyer: parseJsonArray(recommendation.buyer_recommendations),
                opportunity: parseJsonArray(recommendation.opportunity_recommendations),
                partner: parseJsonArray(recommendation.partner_recommendations),
                growth: parseJsonArray(recommendation.growth_recommendations),
                lastUpdated: recommendation.last_updated || null
            }
            : {
                topPriorityActions: [],
                vehicle: [],
                certification: [],
                buyer: [],
                opportunity: [],
                partner: [],
                growth: [],
                lastUpdated: null
            };

        return {
            ok: true,
            service: "PROSPECT_GROWTH_ASSESSMENT",
            status: "ASSESSMENT_READY",
            generatedAt: new Date().toISOString(),
            term: searchTerm,
            match: {
                candidateCount: candidates.length,
                selectedContractorId: contractorId,
                selectedUei: contractor.uei || null
            },
            company: {
                contractorId,
                company: contractor.company || null,
                companyNorm: contractor.company_norm || null,
                uei: contractor.uei || null,
                federalRevenue: contractor.federal_revenue ?? null,
                awardCount: contractor.award_count ?? null,
                vehicle: contractor.vehicle || null,
                vehicleHint: contractor.vehicle_hint || null,
                segment: contractor.segment || null,
                primaryNaics: contractor.primary_naics || null,
                matchedNaics: contractor.all_matched_naics || null,
                smallBusinessFlag: contractor.small_business_flag || null,
                industrySegment: contractor.industry_segment || null,
                marketPriority: contractor.market_priority || null,
                leadScore: contractor.lead_score ?? null,
                city: contractor.city || null,
                state: contractor.state || null,
                entityStatus: contractor.entity_status || null,
                registrationDate: contractor.registration_date || null,
                expirationDate: contractor.expiration_date || null,
                lastUpdated: contractor.last_updated || null
            },
            persona: persona
                ? {
                    primary: persona.primary_persona || null,
                    secondary: persona.secondary_persona || null,
                    score: persona.persona_score ?? null,
                    gsaUnderutilizedScore: persona.gsa_underutilized_score ?? null,
                    vaUnderutilizedScore: persona.va_underutilized_score ?? null,
                    plateauScore: persona.plateau_score ?? null,
                    agencyConcentrationScore: persona.agency_concentration_score ?? null,
                    recompeteRiskScore: persona.recompete_risk_score ?? null,
                    vehicleGapScore: persona.vehicle_gap_score ?? null,
                    setasideDependencyScore: persona.setaside_dependency_score ?? null,
                    growthExpansionScore: persona.growth_expansion_score ?? null,
                    lastUpdated: persona.last_updated || null
                }
                : null,
            recommendations,
            buyerAlignment: buyers,
            linkedOpportunities: opportunities,
            recompeteSignals: recompetes,
            evidence: {
                contractorJoinKey: "contractors.id",
                recommendationJoinKey: "contractor_recommendations_v2.contractor_id",
                personaJoinKey: "persona_scores.contractor_id",
                buyerJoinKey: "buyers.company_id",
                opportunityJoinKey: "opportunities.company_id",
                recompeteJoinKey: "recompetes.company_id"
            },
            safety: {
                databaseMode: "READ_ONLY",
                writesEnabled: false,
                datasetRefreshExecuted: false,
                intelligenceJobExecuted: false,
                emailsSent: false,
                campaignsChanged: false
            }
        };
    }
}

module.exports = ProspectGrowthAssessmentService;
