const { google } = require("googleapis");
const { getAuthClientForAccount, listAccounts } = require("./account_manager");

async function getWorkspaceSnapshot(accountKeyOrEmail) {
  const auth = await getAuthClientForAccount(accountKeyOrEmail);
  const gmail = google.gmail({ version: "v1", auth });
  const calendar = google.calendar({ version: "v3", auth });
  const drive = google.drive({ version: "v3", auth });

  const [profile, messages, events, files] = await Promise.all([
    gmail.users.getProfile({ userId: "me" }),
    gmail.users.messages.list({ userId: "me", maxResults: 5, q: "in:inbox" }),
    calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    }),
    drive.files.list({ pageSize: 5, fields: "files(id,name,mimeType,modifiedTime)" }),
  ]);

  return {
    account: profile.data.emailAddress,
    inboxEstimate: profile.data.messagesTotal,
    recentInboxCount: (messages.data.messages || []).length,
    upcomingEventsCount: (events.data.items || []).length,
    recentDriveFilesCount: (files.data.files || []).length,
  };
}

async function cli() {
  const account = process.argv[2];
  if (!account) {
    const accounts = listAccounts().filter(a => a.valid);
    if (!accounts.length) {
      console.log("No Google accounts registered. Run: node CONNECTORS\\GOOGLE\\account_manager.js add");
      return;
    }
    for (const a of accounts) {
      const snapshot = await getWorkspaceSnapshot(a.accountKey);
      console.log(JSON.stringify(snapshot, null, 2));
    }
    return;
  }
  const snapshot = await getWorkspaceSnapshot(account);
  console.log(JSON.stringify(snapshot, null, 2));
}

if (require.main === module) {
  cli().catch((error) => {
    console.error("Google Workspace snapshot failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { getWorkspaceSnapshot };
