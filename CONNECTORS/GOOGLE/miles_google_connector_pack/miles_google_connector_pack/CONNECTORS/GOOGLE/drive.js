const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getDriveClient() {
  const auth = await getGoogleAuthClient();
  return google.drive({ version: "v3", auth });
}

async function searchFiles(query = "", maxResults = 10) {
  const drive = await getDriveClient();
  const q = query ? `name contains '${query.replace(/'/g, "\\'")}' and trashed=false` : "trashed=false";
  const res = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  return res.data.files || [];
}

async function healthCheck() {
  const files = await searchFiles("", 1);
  return { service: "drive", ok: true, accessible: true, sampleCount: files.length };
}

module.exports = { getDriveClient, searchFiles, healthCheck };
