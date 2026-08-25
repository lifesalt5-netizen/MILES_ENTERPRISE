'use strict';

const fs = require('fs');
const V7Publisher = require('./B12_CONTROLLED_PUBLISHER_V7');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

const pagePhases = {
  GSA_ZERO_SALES_PAGE: {
    scaffold: "Create a page called 'GSA Zero-Sales Diagnostic' at /gsa-zero-sales-diagnostic only if that page does not already exist. If it already exists, use the existing page. Keep it out of main navigation. Match the existing P2GC site style. Do not add detailed copy yet and do not change any other page.",
    content: "On the existing 'GSA Zero-Sales Diagnostic' page only, add the conversion copy. Use the exact headline 'Your GSA Schedule Should Not Be Shelfware.' Use primary CTA 'Review My GSA Revenue Gap'. Add concise sections for who this is for, what P2GC examines, and what the client receives. Add FAQ question 'Will you guarantee sales?' and answer that government awards cannot be guaranteed; P2GC provides evidence-based positioning, prioritization, activation, and execution support. Do not invent proof or metrics. Do not change navigation or other pages."
  },
  FEDERAL_REVENUE_GAP_PAGE: {
    scaffold: "Create a page called 'Federal Revenue Gap Analysis' at /federal-revenue-gap-analysis only if that page does not already exist. If it already exists, use the existing page. Keep it out of main navigation. Match the existing P2GC site style. Do not add detailed copy yet and do not change any other page.",
    content: "On the existing 'Federal Revenue Gap Analysis' page only, add the conversion copy. Use the exact headline 'Find the Gap Between Being Government-Ready and Actually Generating Revenue.' Use primary CTA 'Show Me My Revenue Gaps'. Add concise sections covering buyer and agency alignment, access and positioning gaps, prime/sub/vehicle paths, and the three highest-priority next actions. Include the exact sentence 'This is not a generic opportunity dump.' Do not invent proof or metrics. Do not change navigation or other pages."
  },
  RECOMPETE_VEHICLE_PAGE: {
    scaffold: "Create a page called 'Recompete & Vehicle Growth Scan' at /recompete-vehicle-growth-scan only if that page does not already exist. If it already exists, use the existing page. Keep it out of main navigation. Match the existing P2GC site style. Do not add detailed copy yet and do not change any other page.",
    content: "On the existing 'Recompete & Vehicle Growth Scan' page only, add the conversion copy. Use the exact headline 'Get Positioned Before the Opportunity Becomes a Last-Minute Bid.' Use primary CTA 'Run My Growth Scan'. Explain recompete timing, incumbent context, vehicle/access requirements, agency alignment, and prime-versus-team strategy. Include the recommendation labels PRIME, TEAM, POSITION EARLY, MONITOR, PASS. Do not present modeled recompetes as confirmed procurements and do not invent proof or metrics. Do not change navigation or other pages."
  }
};

class B12ControlledPublisherV8 extends V7Publisher {
  applyCompactPrompts() {
    if (!this.manifest || !Array.isArray(this.manifest.operations)) return;

    const operations = [];
    for (const op of this.manifest.operations) {
      const phases = pagePhases[op.id];
      if (!phases) {
        operations.push(op);
        continue;
      }

      operations.push({
        ...op,
        id: `${op.id}_SCAFFOLD`,
        type: 'AI_AGENT_PAGE_SCAFFOLD',
        prompt: phases.scaffold,
        required_markers: [],
        twoPhase: true,
        phase: 'SCAFFOLD'
      });
      operations.push({
        ...op,
        prompt: phases.content,
        twoPhase: true,
        phase: 'CONTENT'
      });
    }

    this.manifest = { ...this.manifest, operations };
  }

  operationTimeoutMs(prompt) {
    const text = String(prompt || '');
    if (/Create a page called/i.test(text)) return 8 * 60 * 1000;
    if (/On the existing .* page only/i.test(text)) return 8 * 60 * 1000;
    return super.operationTimeoutMs(prompt);
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V8_RESUMABLE_TWO_PHASE_PAGE_BUILD';
      result.promptStrategy = 'TWO_PHASE_SCAFFOLD_THEN_CONTENT';
      result.twoPhasePageBuild = true;
      try {
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV8();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV8;
