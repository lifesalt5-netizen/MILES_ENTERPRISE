const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getCalendarClient() {
  const auth = await getGoogleAuthClient();
  return google.calendar({ version: "v3", auth });
}

async function listUpcomingEvents(maxResults = 10) {
  const calendar = await getCalendarClient();
  const result = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime"
  });
  return result.data.items || [];
}

async function healthCheck() {
  const calendar = await getCalendarClient();
  const result = await calendar.calendarList.list({ maxResults: 1 });
  return { service: "calendar", ok: true, calendarsVisible: (result.data.items || []).length };
}

module.exports = { getCalendarClient, listUpcomingEvents, healthCheck };
