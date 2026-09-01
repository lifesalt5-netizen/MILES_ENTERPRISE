'use strict';

const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const { CATEGORIES } = ReplyIntelligenceService;

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function bodyText(email = {}) {
  return clean([
    email.subject,
    email.text,
    email.body_text,
    email.content_preview,
    email.snippet,
    email.message,
    email?.body?.text
  ].filter(Boolean).join('\n')).toLowerCase();
}

const PITCH_PATTERNS = [
  /\bnew revenue streams?\b/i,
  /\bsearch enquiries? and traffic\b/i,
  /\bproposal for partnership\b/i,
  /\bfeedback on your website\b/i,
  /\bseo (?:audit|services?|proposal|campaign|traffic)\b/i,
  /\bsearch engine (?:optimization|optimisation|traffic|ranking)\b/i,
  /\bwebsite (?:traffic|ranking|redesign|optimization|optimisation)\b/i,
  /\blead generation\b/i,
  /\bappointment setting\b/i,
  /\bcold email services?\b/i,
  /\bmore customers\b/i,
  /\bgrow (?:your|the) (?:business|revenue|sales)\b/i,
  /\bcan (?:we|i) help (?:you|pathways2gc)\b/i,
  /\bwe (?:help|work with) (?:companies|businesses|agencies)\b.{0,80}\b(?:sales|seo|traffic|leads|revenue|marketing)\b/i,
  /\bpartnership opportunity\b/i,
  /\bquick question about (?:your|pathways2gc) website\b/i
];

class IonosPitchJunkClassifier extends ReplyIntelligenceService {
  classify(email = {}) {
    const text = bodyText(email);
    if (PITCH_PATTERNS.some(pattern => pattern.test(text))) {
      return this.result(email, CATEGORIES.INBOUND_SOLICITATION_SPAM, 0.99, {
        humanReply:false,
        qualifiedPositive:false,
        action:'ROUTE_TO_MILES_JUNK'
      }, text);
    }
    return super.classify(email);
  }
}

IonosPitchJunkClassifier.PITCH_PATTERNS = PITCH_PATTERNS;
module.exports = IonosPitchJunkClassifier;
