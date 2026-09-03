'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = require('../../CONFIG/P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json');

function clean(v) { return String(v == null ? '' : v).trim(); }
function words(v) { return clean(v).split(/\s+/).filter(Boolean).length; }
function isUnavailable(v) { return v == null || v === '' || v === 'UNKNOWN' || v === 'UNAVAILABLE'; }

class P2GCFederalGrowthReviewScriptService {
  constructor(options = {}) {
    this.contract = options.contract || CONTRACT;
    this.wordsPerMinute = Math.max(110, Math.min(165, Number(options.wordsPerMinute || 135)));
  }

  build(input = {}) {
    const company = input.company || {};
    const findings = Array.isArray(input.findings) ? input.findings : [];
    if (!clean(company.name)) throw new Error('COMPANY_NAME_REQUIRED');
    const usable = findings.filter(f => this.isUsableFinding(f));
    if (!usable.length) throw new Error('NO_VERIFIED_FINDINGS_AVAILABLE_FOR_PERSONALIZED_REVIEW');

    const grouped = this.groupBySection(usable);
    const orderedSections = this.contract.personalizedReview.dynamicSections || [];
    const sections = [];

    sections.push(this.opening(company, usable));
    for (const sectionName of orderedSections) {
      const items = grouped.get(sectionName) || [];
      if (!items.length) continue;
      sections.push(this.renderSection(sectionName, items));
    }
    sections.push(this.nextStep(company, usable));

    const fullText = sections.map(s => s.script).join('\n\n');
    const wordCount = words(fullText);
    const runtimeMinutes = Number((wordCount / this.wordsPerMinute).toFixed(1));
    const target = this.contract.product.targetRuntimeMinutes || { min: 6, max: 10 };

    return {
      ok: true,
      status: 'P2GC_PERSONALIZED_REVIEW_SCRIPT_READY',
      company: clean(company.name),
      advisorRole: this.contract.product.primaryAdvisorRole,
      sections,
      fullText,
      wordCount,
      estimatedRuntimeMinutes: runtimeMinutes,
      runtimeTarget: target,
      runtimeStatus: runtimeMinutes < target.min ? 'SHORT_REVIEW_NEEDS_MORE_VERIFIED_EXPLANATION' : runtimeMinutes > target.max ? 'LONG_REVIEW_NEEDS_COMPRESSION' : 'WITHIN_TARGET',
      priorityOptions: this.priorityOptions(usable),
      withheldPaidWork: [...this.contract.personalizedReview.freeReviewBoundary.withhold],
      generatedAt: new Date().toISOString()
    };
  }

  isUsableFinding(f = {}) {
    if (!clean(f.title) || !clean(f.finding)) return false;
    if (f.material !== false) {
      if (!clean(f.source) || !clean(f.freshness) || !clean(f.confidence) || !clean(f.verificationState)) return false;
      if (/STALE|EXPIRED/i.test(clean(f.freshness))) return false;
      if (!/CONFIRMED|VERIFIED|CURRENT|SUPPORTED/i.test(clean(f.verificationState))) return false;
    }
    if (f.expired === true || f.active === false && /OPPORTUNIT/i.test(clean(f.section))) return false;
    return true;
  }

  groupBySection(findings) {
    const map = new Map();
    for (const f of findings) {
      const section = clean(f.section) || 'FEDERAL_GROWTH_GAPS';
      if (!map.has(section)) map.set(section, []);
      map.get(section).push(f);
    }
    return map;
  }

  opening(company, findings) {
    const verifiedCount = findings.filter(f => f.material !== false).length;
    return {
      id: 'OPENING',
      title: `Your Personalized Federal Growth Review`,
      script: [
        `Welcome. I’m your P2GC Federal Growth Advisor, and this review was prepared specifically for ${clean(company.name)}.`,
        `We analyzed your current federal position using verified company-specific evidence. In this review I’ll walk through the most important findings, what each one means, why it matters commercially, and where P2GC sees the strongest next-step decisions.`,
        `This is not a generic federal contracting presentation. The review includes ${verifiedCount} verified material finding${verifiedCount === 1 ? '' : 's'} selected because they are relevant to your actual position.`,
        `Where authoritative information is unavailable, we treat it as unknown rather than zero. We also do not present expired opportunities as active, and we distinguish holding a contract vehicle from actually producing revenue through it.`,
        `The goal of this free review is to show you the evidence and the decisions it points to. The complete buyer lists, full opportunity inventory, partner targeting, detailed capture plan, outreach strategy, pricing strategy, and implementation roadmap are completed inside the applicable P2GC engagement.`
      ].join(' ')
    };
  }

  renderSection(sectionName, findings) {
    const title = this.sectionTitle(sectionName);
    const paragraphs = [`Let’s look at ${title.toLowerCase()}.`];
    for (const f of findings.slice(0, 4)) {
      paragraphs.push(this.renderFinding(f));
    }
    if (findings.length > 4) {
      paragraphs.push(`There are ${findings.length - 4} additional verified findings in this area that are held for the complete validation and execution roadmap.`);
    }
    return {
      id: sectionName,
      title,
      findingCount: findings.length,
      script: paragraphs.join(' ')
    };
  }

  renderFinding(f) {
    const pieces = [];
    pieces.push(`Finding: ${clean(f.title)}. ${clean(f.finding)}`);
    if (clean(f.whatItMeans)) pieces.push(`What that means: ${clean(f.whatItMeans)}`);
    if (clean(f.whyItMatters)) pieces.push(`Why it matters: ${clean(f.whyItMatters)}`);
    if (clean(f.businessImpact)) pieces.push(`Business impact: ${clean(f.businessImpact)}`);
    if (clean(f.howP2GCAddressesIt)) pieces.push(`How P2GC addresses it: ${clean(f.howP2GCAddressesIt)}`);
    return pieces.join(' ');
  }

  nextStep(company, findings) {
    const priorities = this.priorityOptions(findings);
    const labels = priorities.map(p => p.label);
    const focus = labels.length ? labels.slice(0, 3).join(', ') : 'the highest-value federal growth issue shown in this review';
    return {
      id: 'NEXT_STEP',
      title: 'Recommended Next Step',
      script: [
        `Based on the evidence reviewed for ${clean(company.name)}, the next step is not to chase every visible signal. It is to validate the highest-value path and turn the evidence into a prioritized execution roadmap.`,
        `The areas we would prioritize first include ${focus}.`,
        `If you have watched most of this review, the best next move is a focused 15-to-20-minute review with Kevin within the next two business days. Before the call, you can submit any questions you want Kevin to address and tell us what you would most like to address first.`,
        `Kevin will come to that conversation with a close brief prepared from your company intelligence and your review activity so the conversation can focus on final questions, the right P2GC package, and whether it makes sense to move forward.`
      ].join(' ')
    };
  }

  priorityOptions(findings) {
    return findings
      .filter(f => f.material !== false && f.freePreviewVisibility !== 'LOCKED')
      .slice(0, 5)
      .map(f => ({ id: f.id || null, label: clean(f.title) }));
  }

  sectionTitle(name) {
    const map = {
      CURRENT_GOVERNMENT_POSITION: 'Current Government Position',
      WHAT_IS_WORKING: 'What Is Working',
      AWARD_REVENUE_POSITION: 'Award and Revenue Position',
      AGENCY_POSITION: 'Agency Position',
      VEHICLE_GSA_VA_POSITION: 'Vehicle, GSA, and VA Position',
      PRIME_SUB_POSITION: 'Prime and Subcontracting Position',
      CERTIFICATION_POSITION: 'Certification Position',
      OPPORTUNITY_ENVIRONMENT: 'Opportunity Environment',
      RECOMPETE_REVENUE_EXPOSURE: 'Recompete and Revenue Exposure',
      POSITION_VS_MARKET: 'Position Versus the Market',
      FEDERAL_GROWTH_GAPS: 'Federal Growth Gaps',
      P2GC_DIAGNOSIS: 'P2GC Diagnosis',
      RECOMMENDED_P2GC_PATHWAY: 'Recommended P2GC Pathway',
      NEXT_STEP: 'Next Step'
    };
    return map[name] || clean(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

module.exports = P2GCFederalGrowthReviewScriptService;
