# MILES Google Workspace Connector

This connector gives MILES authenticated access to Google Workspace:

- Gmail
- Calendar
- Drive
- Contacts

## Required files

Place your OAuth client JSON here:

CONFIG/Credentials/google_oauth_client.json

The first successful authorization creates:

CONFIG/Credentials/google_token.json

Do not commit either file.

## Commands

Test OAuth:

node CONNECTORS/GOOGLE/auth.js

Run full Google health check:

node CONNECTORS/GOOGLE/index.js
