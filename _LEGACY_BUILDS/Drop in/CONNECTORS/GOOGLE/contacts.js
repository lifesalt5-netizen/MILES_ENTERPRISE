const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getPeopleClient() {
  const auth = await getGoogleAuthClient();
  return google.people({ version: "v1", auth });
}

async function listContacts(pageSize = 10) {
  const people = await getPeopleClient();
  const result = await people.people.connections.list({
    resourceName: "people/me",
    pageSize,
    personFields: "names,emailAddresses,phoneNumbers,organizations"
  });
  return result.data.connections || [];
}

async function healthCheck() {
  const contacts = await listContacts(1);
  return { service: "contacts", ok: true, sampleContactsVisible: contacts.length };
}

module.exports = { getPeopleClient, listContacts, healthCheck };
