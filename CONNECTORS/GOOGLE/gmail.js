const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function listRecentEmails(maxResults = 10) {
  const auth = await getGoogleAuthClient();

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: "in:inbox",
  });

  const messages = response.data.messages || [];

  console.log("====================================");
  console.log("MILES GMAIL TEST");
  console.log("====================================");
  console.log(`Inbox messages found: ${messages.length}`);

  for (const message of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload.headers;
    const from = headers.find(h => h.name === "From")?.value || "";
    const subject = headers.find(h => h.name === "Subject")?.value || "";
    const date = headers.find(h => h.name === "Date")?.value || "";

    console.log("");
    console.log(`From: ${from}`);
    console.log(`Subject: ${subject}`);
    console.log(`Date: ${date}`);
  }
}

if (require.main === module) {
  listRecentEmails().catch((error) => {
    console.error("Gmail test failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  listRecentEmails,
};