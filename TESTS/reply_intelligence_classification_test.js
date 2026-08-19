"use strict";

const assert = require("assert");
const ReplyIntelligenceService = require("../SERVICES/revenue/ReplyIntelligenceService");

const now = () => new Date("2026-08-18T19:30:00-04:00");
const service = new ReplyIntelligenceService({ now });

function email(subject, text, extra = {}) {
  return { id:`${Math.random()}`, subject, body:{text}, from_address_email:extra.from||"prospect@example.com", campaign_id:extra.campaign_id ?? "camp-1", lead_id:extra.lead_id ?? "lead-1", ...extra };
}

const cases = [
  [email("Re: Your GSA Schedule", "How much does this cost?"), "PRICING_QUESTION", true],
  [email("Re: Federal contracting expansion", "Open to a conversation but as a prerequisite I only accept..."), "MEETING_INTENT", true],
  [email("Re: Quick question", "No thanks. Have a great day."), "NEGATIVE", false],
  [email("RE: Quick question", "unsubscribe Respectfully, Tom"), "UNSUBSCRIBE", false],
  [email("Out of Office: Re: Your GSA Schedule", "I will be out of the office until 8/21/26."), "OOO", false],
  [email("Automatic reply", "Thank you for contacting us. We've received your message."), "AUTO_REPLY", false],
  [email("Mail delivery failed", "Undeliverable: recipient address rejected"), "BOUNCE_TECHNICAL", false],
  [email("Help with your marketing", "We provide marketing services and lead generation to help you grow your business.", { campaign_id:"", lead_id:"" }), "INBOUND_SOLICITATION_SPAM", false],
  [email("Re: Federal growth", "Please contact Jane Smith; she is the right person for this."), "REFERRAL", true],
  [email("Re: Federal growth", "Not right now. Circle back next quarter."), "NOT_NOW", false],
  [email("Re: Federal growth", "Can you send some information about what is included?"), "NEUTRAL_QUESTION", false],
  [email("Re: Federal growth", "Interested. Please tell me more."), "INTERESTED", true]
];

const classifications=[];
for(const [input,expectedCategory,expectedQualified] of cases){ const result=service.classify(input); classifications.push(result); assert.strictEqual(result.category,expectedCategory,`${input.subject}: expected ${expectedCategory}, got ${result.category}`); assert.strictEqual(result.qualifiedPositive,expectedQualified,`${expectedCategory} qualifiedPositive mismatch`); }

// Live-audit regression: affordability deferral beats generic pricing words.
const tooRich=service.classify(email("RE: P2GC Consulting and QVH","Thx Kevin . . . too rich for a startup, maybe a year from now."));
assert.strictEqual(tooRich.category,"NOT_NOW");
assert.strictEqual(tooRich.qualifiedPositive,false);
assert(new Date(tooRich.followUpAt).getTime()>now().getTime()+200*86400000,"year deferral should schedule long-term nurture");

// Live-audit regression: automated mailbox must never become INTERESTED.
const enviro=service.classify(email("Re: Your GSA Schedule","Hi there, Thanks for reaching out! You've reached an email inbox that is monitored automatically.",{from:"envirospark-automated-emails@envirosparkenergy.com"}));
assert.strictEqual(enviro.category,"AUTO_REPLY");
assert.strictEqual(enviro.humanReply,false);

// Quoted prior outbound copy cannot turn a current neutral/negative note into a pricing lead.
const quoted=service.classify(email("Re: Your GSA Schedule","Thanks Kevin, not right now.\n\nOn Wed, Jul 29, 2026 at 08:43 Kevin wrote:\nThe Sprint is $2,500. How much capacity do you need?"));
assert.strictEqual(quoted.category,"NOT_NOW");
assert(!/2,500/.test(quoted.preview),"preview must contain current reply only, not quoted history");

// A prospect pitching their product back on an outbound thread is solicitation, not pricing/interested.
const productPitch=service.classify(email("QuadVideoHALO: Product Offering","Kevin, our product offering provides a video solution for federal agencies.",{from:"bryan@quadvideohalo.com"}));
assert.strictEqual(productPitch.category,"INBOUND_SOLICITATION_SPAM");
assert.strictEqual(productPitch.qualifiedPositive,false);

const ooo=service.classify(email("Out of Office","Returning August 21."));
assert.strictEqual(ooo.category,"OOO"); assert(ooo.followUpAt); assert(new Date(ooo.followUpAt).getTime()>now().getTime());

const summary=service.summarize(classifications);
assert.strictEqual(summary.rawReceived,12); assert.strictEqual(summary.qualifiedPositiveReplies,4); assert(summary.humanReplies<summary.rawReceived); assert.strictEqual(summary.counts.UNSUBSCRIBE,1); assert.strictEqual(summary.counts.OOO,1); assert.strictEqual(summary.counts.BOUNCE_TECHNICAL,1);
console.log("PASS reply_intelligence_classification_test");
