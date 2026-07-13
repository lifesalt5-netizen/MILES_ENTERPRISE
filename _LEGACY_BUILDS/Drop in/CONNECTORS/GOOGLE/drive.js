const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getDriveClient() {
  const auth = await getGoogleAuthClient();
  return google.drive({ version: "v3", auth });
}

async function listRecentFiles(pageSize = 10) {
  const drive = await getDriveClient();
  const result = await drive.files.list({
    pageSize,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc"
  });
  return result.data.files || [];
}

async function healthCheck() {
  const files = await listRecentFiles(1);
  return { service: "drive", ok: true, sampleFilesVisible: files.length };
}

module.exports = { getDriveClient, listRecentFiles, healthCheck };
