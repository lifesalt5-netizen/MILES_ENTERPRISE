'use strict';

const assert=require('assert');
const {createResponseBuffer,buildMessage}=require('../CONNECTORS/IONOS/smtp_governed');

(async()=>{
  const responses=createResponseBuffer();

  // Prove a greeting that arrives before any waiter is not lost.
  responses.pushLine('220 smtp.ionos.com ESMTP ready');
  assert.strictEqual(responses.pendingCompleted(),1);
  assert.strictEqual(responses.pendingWaiters(),0);
  const greeting=await responses.read();
  assert.strictEqual(greeting.code,220);
  assert.strictEqual(responses.pendingCompleted(),0);

  // Prove multiline responses complete only on the final "code space" line.
  responses.pushLine('250-smtp.ionos.com');
  responses.pushLine('250-AUTH LOGIN PLAIN');
  assert.strictEqual(responses.pendingCompleted(),0);
  responses.pushLine('250 SIZE 104857600');
  const ehlo=await responses.read();
  assert.strictEqual(ehlo.code,250);
  assert.strictEqual(ehlo.lines.length,3);

  // Prove a waiter attached first still resolves normally.
  const pending=responses.read();
  assert.strictEqual(responses.pendingWaiters(),1);
  responses.pushLine('334 VXNlcm5hbWU6');
  const auth=await pending;
  assert.strictEqual(auth.code,334);
  assert.strictEqual(responses.pendingWaiters(),0);

  // Prove server error responses reject whether buffered early or delivered to a waiter.
  responses.pushLine('535 Authentication credentials invalid');
  await assert.rejects(()=>responses.read(),/IONOS_SMTP_535/);
  const pendingError=responses.read();
  responses.pushLine('550 Requested action not taken');
  await assert.rejects(()=>pendingError,/IONOS_SMTP_550/);

  const message=buildMessage({from:'kevin@pathways2gc.com',to:'buyer@example.com',replyTo:'kevin@pathways2gc.com',subject:'Test',text:'Line 1\nLine 2'});
  assert(message.includes('From: kevin@pathways2gc.com'));
  assert(message.includes('Reply-To: kevin@pathways2gc.com'));
  assert(message.includes('\r\n\r\nLine 1\r\nLine 2'));

  console.log('IONOS_SMTP_RESPONSE_BUFFER_GREEN');
})().catch(error=>{console.error(error);process.exit(2);});
