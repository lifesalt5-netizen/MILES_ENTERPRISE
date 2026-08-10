"use strict";

const assert = require("assert");
const service = require("../SERVICES/StateSledEmailDiscoveryService");

const html = `
<html>
<body>
Contact us at INFO@Example.com or sales@example.com.
Ignore noreply@example.com.
</body>
</html>`;

const emails = service.extractEmails(html);
assert(emails.includes("info@example.com"));
assert(emails.includes("sales@example.com"));

const rules = {
  discovery: {
    preferredLocalParts: ["contact", "info", "sales"],
    excludeLocalParts: ["noreply", "no-reply"]
  }
};

assert.strictEqual(
  service.chooseEmail(emails, "example.com", rules),
  "info@example.com"
);

assert.strictEqual(
  service.chooseEmail(["info@other.com"], "example.com", rules),
  ""
);

assert.strictEqual(
  service.normalizeDomain("https://www.Example.com/contact"),
  "example.com"
);

(async () => {
  const verification = await service.verifyEmail(
    "info@example.com",
    {
      verification: {
        apiBaseUrl: "https://api.millionverifier.com/api/v3/",
        timeoutSeconds: 10,
        acceptedResults: ["ok"],
        rejectedResults: ["invalid", "disposable"]
      }
    },
    null
  );

  assert.strictEqual(verification.status, "NOT_RUN");
  assert.strictEqual(verification.reason, "API_KEY_MISSING");

  console.log("STATE_SLED_EMAIL_DISCOVERY_TEST=PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
