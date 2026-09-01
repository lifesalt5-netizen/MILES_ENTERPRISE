'use strict';

const assert = require('assert');
const Classifier = require('../SERVICES/revenue/IonosPitchJunkClassifier');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const classifier = new Classifier();
const samples = [
  ['New Revenue Streams for pathways2gc.com','We help companies create new revenue streams and more customers.'],
  ['Search Enquiries and Traffic','We can improve your website SEO and search traffic.'],
  ['Proposal for Partnership','I have a partnership opportunity for your agency.'],
  ['Feedback on your website','Quick question about your website and rankings.']
];

for (const [subject,text] of samples) {
  const result = classifier.classify({ from:'seller@example.com', subject, text });
  assert.strictEqual(result.category, CATEGORIES.INBOUND_SOLICITATION_SPAM, subject);
  assert.strictEqual(result.humanReply, false, subject);
  assert.strictEqual(result.action, 'ROUTE_TO_MILES_JUNK', subject);
}

const realReply = classifier.classify({
  from:'buyer@agency.gov',
  subject:'Re: Federal Growth Review',
  text:'Yes, I am interested. Can we schedule a call?'
});
assert.notStrictEqual(realReply.category, CATEGORIES.INBOUND_SOLICITATION_SPAM);

console.log('IONOS_PITCH_JUNK_CLASSIFIER_TEST_PASS');
