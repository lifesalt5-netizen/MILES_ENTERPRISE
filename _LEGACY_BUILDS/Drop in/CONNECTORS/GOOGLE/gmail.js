const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getGmailClient() {
  const auth = await getGoogleAuthClient();
  return google.gmail({ version: "v1", auth });
}

async function listRecentMessages(maxResults = 10) {
  const gmail = await getGmailClient();
  const result = await gmail.users.messages.list({ userId: "me", maxResults });
  return result.data.messages || [];
}

async function getMessage(messageId) {
  const gmail = await getGmailClient();
  const result = await gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata" });
  return result.data;
}

async function healthCheck() {
  const gmail = await getGmailClient();
  const profile = await gmail.users.getProfile({ userId: "me" });
  return { service: "gmail", ok: true, email: profile.data.emailAddress, messagesTotal: profile.data.messagesTotal };
}

module.exports = { getGmailClient, listRecentMessages, getMessage, healthCheck };
