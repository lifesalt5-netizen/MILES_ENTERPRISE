const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getGmailClient() {
  const auth = await getGoogleAuthClient();
  return google.gmail({ version: "v1", auth });
}

async function listUnreadEmails(maxResults = 10) {
  const gmail = await getGmailClient();
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread -category:promotions -category:social",
    maxResults,
  });

  const messages = res.data.messages || [];
  const hydrated = [];
  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = Object.fromEntries((full.data.payload.headers || []).map((h) => [h.name, h.value]));
    hydrated.push({
      id: msg.id,
      from: headers.From || "",
      subject: headers.Subject || "",
      date: headers.Date || "",
      snippet: full.data.snippet || "",
    });
  }
  return hydrated;
}

async function healthCheck() {
  const gmail = await getGmailClient();
  const profile = await gmail.users.getProfile({ userId: "me" });
  return { service: "gmail", ok: true, email: profile.data.emailAddress, messagesTotal: profile.data.messagesTotal };
}

module.exports = { getGmailClient, listUnreadEmails, healthCheck };
