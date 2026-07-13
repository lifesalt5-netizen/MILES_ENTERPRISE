const { google } = require("googleapis");
const { getGoogleAuthClient } = require("./auth");

async function getPeopleClient() {
  const auth = await getGoogleAuthClient();
  return google.people({ version: "v1", auth });
}

async function listContacts(pageSize = 10) {
  const people = await getPeopleClient();
  const res = await people.people.connections.list({
    resourceName: "people/me",
    pageSize,
    personFields: "names,emailAddresses,phoneNumbers,organizations",
  });
  return (res.data.connections || []).map((p) => ({
    resourceName: p.resourceName,
    name: p.names?.[0]?.displayName || "",
    email: p.emailAddresses?.[0]?.value || "",
    phone: p.phoneNumbers?.[0]?.value || "",
    organization: p.organizations?.[0]?.name || "",
  }));
}

async function healthCheck() {
  const contacts = await listContacts(1);
  return { service: "contacts", ok: true, sampleCount: contacts.length };
}

module.exports = { getPeopleClient, listContacts, healthCheck };
