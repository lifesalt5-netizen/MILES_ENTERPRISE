# MILES Google Workspace Connector

Provides OAuth authentication and service clients for Gmail, Calendar, Drive, and Contacts.

## Requirements

Install packages from the repo root:

```powershell
npm install googleapis @google-cloud/local-auth dotenv
```

OAuth credentials must be at one of these locations:

```text
CONFIG/Credentials/google_oauth_client.json
CONFIG/credentials/google_oauth_client.json
```

or set in `.env`:

```text
GOOGLE_OAUTH_CLIENT=D:\P2GC_Intelligence\MILES_OS\MILES_OS_v1\CONFIG\Credentials\google_oauth_client.json
```

## Test auth

```powershell
node CONNECTORS/GOOGLE/auth.js
```

## Test all Google services

```powershell
node CONNECTORS/GOOGLE/health.js
```

The first run opens a Google OAuth browser window and creates:

```text
CONFIG/Credentials/google_token.json
```

Do not commit credentials or token files to Git.
