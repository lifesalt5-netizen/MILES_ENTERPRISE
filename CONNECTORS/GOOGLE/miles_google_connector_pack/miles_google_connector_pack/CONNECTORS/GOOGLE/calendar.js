const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getCalendarClient() {
  const auth = await getGoogleAuthClient();
  return google.calendar({ version: "v3", auth });
}

async function listTodaysEvents() {
  const calendar = await getCalendarClient();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(No title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || "",
  }));
}

async function healthCheck() {
  const calendar = await getCalendarClient();
  const res = await calendar.calendarList.list({ maxResults: 1 });
  return { service: "calendar", ok: true, calendarsVisible: (res.data.items || []).length };
}

module.exports = { getCalendarClient, listTodaysEvents, healthCheck };
