const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function healthCheck() {
  try {
    const auth = await getGoogleAuthClient();
    const oauth2 = google.oauth2({ auth, version: "v2" });
    const profile = await oauth2.userinfo.get();
    return {
      status: "OK",
      service: "GOOGLE",
      account: profile.data.email,
      message: "Google Workspace authenticated",
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "ERROR",
      service: "GOOGLE",
      message: error.message,
      checkedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  name: "GOOGLE",
  healthCheck,
  gmail: require("./gmail"),
  calendar: require("./calendar"),
  drive: require("./drive"),
  contacts: require("./contacts"),
};
