const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");
const accountManager = require("./account_manager");

async function listRecentEmails(maxResults = 10) {
  const auth = await getGoogleAuthClient();
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.messages.list({ userId: "me", maxResults, q: "in:inbox" });
  const messages = response.data.messages || [];
  console.log("====================================");
  console.log("MILES GMAIL TEST");
  console.log("====================================");
  console.log(`Inbox messages found: ${messages.length}`);
  for (const message of messages) {
    const detail = await gmail.users.messages.get({ userId: "me", id: message.id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
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

function encodeHeader(value) {
  const text = String(value == null ? "" : value);
  return /[^\x20-\x7E]/.test(text) ? `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=` : text;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map(v => String(v || "").trim()).filter(Boolean);
  return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
}

async function getAccountGmail(accountValue) {
  const account = String(accountValue || "").trim().toLowerCase();
  if (!account || !account.includes("@")) throw new Error("A specific Google Workspace sender account is required.");
  const auth = await accountManager.getAuthClientForAccount(account);
  const gmail = google.gmail({ version:"v1", auth });
  const profile = await gmail.users.getProfile({ userId:"me" });
  const authenticatedEmail = String(profile?.data?.emailAddress || "").trim().toLowerCase();
  if (authenticatedEmail !== account) {
    throw new Error(`Authenticated Google account mismatch: expected ${account}, got ${authenticatedEmail || "unknown"}.`);
  }
  return { account, auth, gmail, profile:profile?.data || {} };
}

async function healthCheckSender(accountValue) {
  try {
    const { account, profile } = await getAccountGmail(accountValue);
    return {
      ok:true,
      status:"GMAIL_SENDER_READY",
      account,
      messagesTotal:Number(profile?.messagesTotal || 0),
      threadsTotal:Number(profile?.threadsTotal || 0),
      checkedAt:new Date().toISOString()
    };
  } catch (error) {
    return {
      ok:false,
      status:"GMAIL_SENDER_NOT_READY",
      account:String(accountValue || "").trim().toLowerCase() || null,
      error:error.message,
      checkedAt:new Date().toISOString()
    };
  }
}

async function sendEmail(options = {}) {
  const account = String(options.account || options.from || "").trim().toLowerCase();
  const to = normalizeRecipients(options.to);
  if (!to.length) throw new Error("At least one recipient is required.");
  const subject = String(options.subject || "").trim();
  if (!subject) throw new Error("Email subject is required.");
  const text = String(options.text || "").replace(/\r?\n/g, "\r\n");
  const replyTo = String(options.replyTo || account).trim();
  const ready = await getAccountGmail(account);

  const headers = [
    `From: ${ready.account}`,
    `To: ${to.join(", ")}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ];
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${text}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const response = await ready.gmail.users.messages.send({ userId:"me", requestBody:{ raw } });
  return {
    ok:true,
    status:"GMAIL_SENT",
    account:ready.account,
    to,
    subject,
    messageId:response?.data?.id || null,
    threadId:response?.data?.threadId || null,
    sentAt:new Date().toISOString()
  };
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
  healthCheckSender,
  sendEmail,
};
