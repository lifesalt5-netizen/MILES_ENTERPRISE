'use strict';

function replaceRequired(src, from, to, label) {
  if (!src.includes(from)) throw new Error(label);
  return src.replace(from, to);
}

function applyV12Tighten(src) {
  // Preserve the V11 question behavior while trimming only repetitive narration around the questions.
  const questionLoop = "for(const s of master.scenes){let body=clean(s.narration);const questions=[];";
  const concise = `const conciseNarration={
1:"Federal contractors have information everywhere: awards, forecasts, agency portals, GSA data, teaming opportunities and solicitations. The harder issue is what those signals mean for your business. A company can look healthy on paper while important growth risks sit underneath. The P2GC Federal Growth Review connects those signals so you can see what deserves attention first.",
2:"The Federal Growth Review connects current position, revenue exposure, vehicle use, agency buying patterns, competitive movement and realistic expansion paths. The goal is not a longer opportunity list. It is to turn federal data into business meaning and a clearer growth pathway. Next, we’ll use a fictional company to show what we review, why it matters, and how the findings point to a practical growth path.",
3:"Apex Ridge Solutions appears successful. It has 11.8 million dollars in five-year federal awards and about 4.2 million dollars in annual federal revenue. Sixty-one percent is prime work, but half of current revenue comes from one agency. Its fictional scorecard is revenue stability 62, vehicle utilization 41, agency diversification 55, prime position 68, opportunity fit 74, and overall federal growth position 60 out of 100. These are demonstration scores only. The real issue is how healthy, protected and scalable the position is.",
4:"A contract vehicle creates access, not revenue. Apex Ridge has an active GSA Schedule with two relevant SINs, but only about 460 thousand dollars of its 4.2 million dollars in annual federal revenue flows through that vehicle. That does not prove underperformance. It raises whether existing access is being used effectively and whether buyer reach or positioning can improve.",
5:"Apex Ridge still has 4.2 million dollars in current federal revenue, but 2.7 million dollars is tied to contracts, option periods or buyer relationships that may need attention within 18 months. That is about 64 percent of the current revenue base entering an exposure view. It does not mean the revenue will be lost. It means the company needs to know what requires protection, when recompetes approach, and where concentration creates dependency.",
6:"A contractor can see dozens or hundreds of possible pursuits, but every pursuit consumes time and proposal resources. P2GC looks across active procurements, recompetes, forecasts, agency buying patterns, vehicles, prime opportunities, teaming paths, VA or VISN activity, and adjacent NAICS markets, then filters for fit. In this example, dozens of possibilities become seven qualified paths. The goal is not the most opportunities. It is the right opportunities for the company.",
7:"Performance needs context. Apex Ridge produces 4.2 million dollars annually, while several fictional peers reach more agencies and show higher prime percentages. That does not mean Apex Ridge is losing. It shows where competitors may be building position first. Competitive movement matters because missed buying activity can become missed positioning before a solicitation appears.",
8:"Together, the findings tell more than the revenue number alone. GSA may be underused, half of revenue sits in one agency, 2.7 million dollars may require protection, adjacent-buyer reach is limited, and prime position can improve. Those findings can point to revenue to protect, vehicles to use better, agencies to expand into, stronger prime positions, and pursuits to prioritize or ignore. No guaranteed wins, just better-informed decisions.",
9:"That leads to Protect, Expand and Capture. Protect existing revenue and buyer relationships. Expand into logical agencies, vehicles and stronger prime positions. Then capture the opportunities with the best fit. Sequence matters: know what deserves attention first, what comes next, and what should not consume resources.",
10:"Every company starts in a different place. Some already have federal awards. Some have a GSA or VA vehicle with low or zero sales. Some have strong subcontracting performance and may be ready for a Sub-to-Prime strategy. Some have strong state, local, or education performance and want a SLED-to-Fed pathway. Some have never won a federal award. For those companies, the review focuses on readiness, target agencies, buyer fit, teaming or prime strategy, vehicle needs and the most realistic path to a first federal win. The goal is to identify the growth path that fits your company today.",
11:"If you want to see what this process reveals about your company, schedule your FREE company-specific Federal Growth Review demo. We’ll use your actual position to show what appears to deserve attention first and which growth pathways may make the most sense. There is no generic sales presentation. Schedule at pathways two g c dot com slash schedule. Thank you for watching."
};for(const s of master.scenes){if(conciseNarration[s.scene])s.narration=conciseNarration[s.scene];}`;
  src = replaceRequired(src, questionLoop, concise + questionLoop, 'V12_CONCISE_NARRATION_ANCHOR_NOT_FOUND');

  // Keep the question-first rhythm, but trim excess dead time around non-question points.
  src = src
    .replace('const BETWEEN_CHUNK_HOLD=0.30;', 'const BETWEEN_CHUNK_HOLD=0.24;')
    .replace('const BETWEEN_SCENE_HOLD=0.70;', 'const BETWEEN_SCENE_HOLD=0.60;')
    .replace('(impactful?0.45:BETWEEN_CHUNK_HOLD)', '(impactful?0.38:BETWEEN_CHUNK_HOLD)')
    .replace('const lead=question?0.60:0.16;', 'const lead=question?0.50:0.10;');

  // Update status labels/window for the tightened question-sequence pass.
  src = src
    .replace(/V11_QUESTION_SEQUENCE_RENDER/g, 'V12_TIGHT_QUESTION_SEQUENCE_RENDER')
    .replace(/Final V11 question-sequenced MP4 created/g, 'Final V12 tightened question-sequenced MP4 created')
    .replace(/FINAL_V11_/g, 'FINAL_V12_')
    .replace(/v11_concat\.txt/g, 'v12_concat.txt')
    .replace(/final_v11_mp4_created/g, 'final_v12_mp4_created')
    .replace('status.targetRuntimeSeconds=510;status.runtimeTargetWindowSeconds=[490,550];status.goGreen=actual>=490&&actual<=550;', 'status.targetRuntimeSeconds=500;status.runtimeTargetWindowSeconds=[480,525];status.goGreen=actual>=480&&actual<=525;');

  return src;
}

module.exports = { applyV12Tighten };
