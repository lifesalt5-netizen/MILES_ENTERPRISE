"use strict";

const fs = require("fs");
const path = require("path");

const infrastructureRegistry =
  require("./InfrastructureRegistryService");

const ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const DATA_DIR = path.join(
  ROOT,
  "DATA",
  "security"
);

const STATE_FILE = path.join(
  DATA_DIR,
  "credential_authority_state.json"
);

const HISTORY_FILE = path.join(
  DATA_DIR,
  "credential_authority_history.jsonl"
);

const ENV_FILE = path.join(
  ROOT,
  ".env"
);

const CREDENTIAL_DEFINITIONS = {
  instantly: {
    infrastructureId: "instantly",

    mode: "ANY_GROUP",

    groups: [
      {
        name: "API",
        required: [
          "INSTANTLY_API_KEY"
        ],
        alternatives: [
          "INSTANTLY_API_TOKEN"
        ]
      },

      {
        name: "BrowserLogin",
        required: [
          "INSTANTLY_EMAIL",
          "INSTANTLY_PASSWORD"
        ]
      }
    ]
  },

  google_workspace: {
    infrastructureId:
      "google_workspace",

    mode:
      "ANY_GROUP",

    groups: [
      {
        name:
          "OAuth",

        required: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_REFRESH_TOKEN"
        ]
      },

      {
        name:
          "ServiceAccountFile",

        requiredFiles: [
          "GOOGLE_SERVICE_ACCOUNT_FILE"
        ],

        alternativesFiles: [
          "GOOGLE_APPLICATION_CREDENTIALS"
        ]
      }
    ]
  },

  domains: {
    infrastructureId:
      "domains",

    mode:
      "ANY_GROUP",

    groups: [
      {
        name:
          "Namecheap",

        required: [
          "NAMECHEAP_API_USER",
          "NAMECHEAP_API_KEY",
          "NAMECHEAP_USERNAME",
          "NAMECHEAP_CLIENT_IP"
        ]
      },

      {
        name:
          "IONOS_API",

        required: [
          "IONOS_API_KEY"
        ],

        optional: [
          "IONOS_API_PREFIX"
        ]
      },

      {
        name:
          "IONOS_Login",

        required: [
          "IONOS_USERNAME",
          "IONOS_PASSWORD"
        ]
      }
    ]
  },

  website: {
    infrastructureId:
      "website",

    mode:
      "ANY_GROUP",

    groups: [
      {
        name:
          "B12_Login",

        required: [
          "B12_EMAIL",
          "B12_PASSWORD"
        ]
      },

      {
        name:
          "IONOS_Login",

        required: [
          "IONOS_USERNAME",
          "IONOS_PASSWORD"
        ]
      }
    ]
  },

  orion: {
    infrastructureId:
      "orion",

    mode:
      "ANY_GROUP",

    groups: [
      {
        name:
          "ConfiguredDatabasePath",

        requiredFiles: [
          "ORION_DB"
        ],

        alternativesFiles: [
          "ORION_DB_PATH"
        ]
      },

      {
        name:
          "DefaultDatabasePath",

        literalFiles: [
          "D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db"
        ]
      }
    ]
  },

  miles_runtime: {
    infrastructureId:
      "miles_runtime",

    mode:
      "ANY_GROUP",

    groups: [
      {
        name:
          "ConfiguredRoot",

        requiredDirectories: [
          "MILES_ROOT"
        ]
      },

      {
        name:
          "DefaultRoot",

        literalDirectories: [
          ROOT
        ]
      }
    ]
  }
};

function ensureDir(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function nowIso() {
  return new Date()
    .toISOString();
}

function safeWriteJson(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  const temporaryFile =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );

  try {
    fs.renameSync(
      temporaryFile,
      file
    );
  } catch {
    fs.copyFileSync(
      temporaryFile,
      file
    );

    fs.unlinkSync(
      temporaryFile
    );
  }

  return true;
}

function appendHistory(record) {
  ensureDir(
    path.dirname(
      HISTORY_FILE
    )
  );

  fs.appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}

function parseEnvText(text = "") {
  const values = {};

  for (
    const rawLine of
    String(text)
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const separator =
      line.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key =
      line
        .slice(0, separator)
        .trim();

    let value =
      line
        .slice(separator + 1)
        .trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(1, -1);
    }

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function loadDotEnv() {
  try {
    if (
      !fs.existsSync(
        ENV_FILE
      )
    ) {
      return {};
    }

    return parseEnvText(
      fs.readFileSync(
        ENV_FILE,
        "utf8"
      )
    );
  } catch {
    return {};
  }
}

function nonEmpty(value) {
  return (
    value !== undefined &&
    value !== null &&
    String(value).trim() !== ""
  );
}

function resolveEnvironmentValue(
  name,
  dotEnv = {}
) {
  if (
    nonEmpty(
      process.env[name]
    )
  ) {
    return {
      present: true,
      source:
        "PROCESS_ENVIRONMENT",
      value:
        process.env[name]
    };
  }

  if (
    nonEmpty(
      dotEnv[name]
    )
  ) {
    return {
      present: true,
      source:
        "DOT_ENV",
      value:
        dotEnv[name]
    };
  }

  return {
    present: false,
    source: null,
    value: null
  };
}

function resolvePathValue(
  name,
  dotEnv = {},
  expectedType = "file"
) {
  const environment =
    resolveEnvironmentValue(
      name,
      dotEnv
    );

  if (
    !environment.present
  ) {
    return {
      name,
      present: false,
      exists: false,
      source: null,
      path: null,
      expectedType
    };
  }

  const configured =
    String(
      environment.value
    ).trim();

  const resolved =
    path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(
          ROOT,
          configured
        );

  let exists = false;
  let typeValid = false;

  try {
    const stat =
      fs.statSync(resolved);

    exists = true;

    typeValid =
      expectedType ===
        "directory"
        ? stat.isDirectory()
        : stat.isFile();
  } catch {
    exists = false;
    typeValid = false;
  }

  return {
    name,
    present: true,
    exists:
      exists &&
      typeValid,
    source:
      environment.source,
    path:
      resolved,
    expectedType
  };
}

function inspectLiteralPath(
  literalPath,
  expectedType = "file"
) {
  const resolved =
    path.resolve(
      literalPath
    );

  let exists = false;

  try {
    const stat =
      fs.statSync(resolved);

    exists =
      expectedType ===
        "directory"
        ? stat.isDirectory()
        : stat.isFile();
  } catch {
    exists = false;
  }

  return {
    literal: true,
    present: true,
    exists,
    source:
      "LITERAL_PATH",
    path:
      resolved,
    expectedType
  };
}

function unique(values = []) {
  return Array.from(
    new Set(
      values.filter(Boolean)
    )
  );
}

class CredentialAuthorityService {
  constructor(options = {}) {
    this.root =
      options.root ||
      ROOT;

    this.stateFile =
      options.stateFile ||
      STATE_FILE;

    this.historyFile =
      options.historyFile ||
      HISTORY_FILE;

    this.lastState = null;
  }

  inspectVariable(
    name,
    dotEnv
  ) {
    const resolved =
      resolveEnvironmentValue(
        name,
        dotEnv
      );

    return {
      name,
      present:
        resolved.present,
      source:
        resolved.source,
      secret:
        true
    };
  }

  evaluateGroup(
    group = {},
    dotEnv = {}
  ) {
    const variables = [];
    const files = [];
    const directories = [];

    for (
      const name of
      group.required || []
    ) {
      variables.push(
        this.inspectVariable(
          name,
          dotEnv
        )
      );
    }

    for (
      const name of
      group.alternatives || []
    ) {
      variables.push({
        ...this.inspectVariable(
          name,
          dotEnv
        ),
        alternative: true
      });
    }

    for (
      const name of
      group.optional || []
    ) {
      variables.push({
        ...this.inspectVariable(
          name,
          dotEnv
        ),
        optional: true
      });
    }

    for (
      const name of
      group.requiredFiles || []
    ) {
      files.push(
        resolvePathValue(
          name,
          dotEnv,
          "file"
        )
      );
    }

    for (
      const name of
      group.alternativesFiles || []
    ) {
      files.push({
        ...resolvePathValue(
          name,
          dotEnv,
          "file"
        ),
        alternative: true
      });
    }

    for (
      const file of
      group.literalFiles || []
    ) {
      files.push(
        inspectLiteralPath(
          file,
          "file"
        )
      );
    }

    for (
      const name of
      group.requiredDirectories || []
    ) {
      directories.push(
        resolvePathValue(
          name,
          dotEnv,
          "directory"
        )
      );
    }

    for (
      const directory of
      group.literalDirectories || []
    ) {
      directories.push(
        inspectLiteralPath(
          directory,
          "directory"
        )
      );
    }

    const requiredVariables =
      variables.filter(
        item =>
          !item.optional &&
          !item.alternative
      );

    const alternativeVariables =
      variables.filter(
        item =>
          item.alternative
      );

    const requiredFiles =
      files.filter(
        item =>
          !item.alternative
      );

    const alternativeFiles =
      files.filter(
        item =>
          item.alternative
      );

    const requiredDirectories =
      directories.filter(
        item =>
          !item.alternative
      );

    const requiredVariablesReady =
      requiredVariables.every(
        item =>
          item.present
      );

    const alternativesReady =
      alternativeVariables.length === 0 ||
      alternativeVariables.some(
        item =>
          item.present
      );

    const requiredFilesReady =
      requiredFiles.every(
        item =>
          item.exists
      );

    const alternativeFilesReady =
      alternativeFiles.length === 0 ||
      alternativeFiles.some(
        item =>
          item.exists
      );

    const requiredDirectoriesReady =
      requiredDirectories.every(
        item =>
          item.exists
      );

    const ready =
      requiredVariablesReady &&
      alternativesReady &&
      requiredFilesReady &&
      alternativeFilesReady &&
      requiredDirectoriesReady;

    const presentNames =
      unique([
        ...variables
          .filter(
            item =>
              item.present
          )
          .map(
            item =>
              item.name
          ),

        ...files
          .filter(
            item =>
              item.exists
          )
          .map(
            item =>
              item.name ||
              item.path
          ),

        ...directories
          .filter(
            item =>
              item.exists
          )
          .map(
            item =>
              item.name ||
              item.path
          )
      ]);

    const missingNames =
      unique([
        ...requiredVariables
          .filter(
            item =>
              !item.present
          )
          .map(
            item =>
              item.name
          ),

        ...requiredFiles
          .filter(
            item =>
              !item.exists
          )
          .map(
            item =>
              item.name ||
              item.path
          ),

        ...requiredDirectories
          .filter(
            item =>
              !item.exists
          )
          .map(
            item =>
              item.name ||
              item.path
          )
      ]);

    return {
      name:
        group.name ||
        "UnnamedGroup",

      ready,

      present:
        presentNames,

      missing:
        missingNames,

      variables,
      files,
      directories
    };
  }

  evaluateCredential(
    credentialId,
    definition,
    dotEnv
  ) {
    const groups =
      (
        definition.groups || []
      ).map(
        group =>
          this.evaluateGroup(
            group,
            dotEnv
          )
      );

    const readyGroups =
      groups.filter(
        group =>
          group.ready
      );

    const anyEvidence =
      groups.some(
        group =>
          group.present.length > 0
      );

    let ready = false;

    if (
      definition.mode ===
      "ALL_GROUPS"
    ) {
      ready =
        groups.length > 0 &&
        groups.every(
          group =>
            group.ready
        );
    } else {
      ready =
        readyGroups.length > 0;
    }

    const status =
      ready
        ? "VALID"
        : anyEvidence
          ? "PARTIAL"
          : "MISSING";

    const present =
      unique(
        groups.flatMap(
          group =>
            group.present
        )
      );

    const missing =
      unique(
        groups.flatMap(
          group =>
            group.missing
        )
      );

    return {
      id:
        credentialId,

      infrastructureId:
        definition
          .infrastructureId,

      status,

      ready,

      mode:
        definition.mode ||
        "ANY_GROUP",

      groups,

      present,

      missing,

      checkedAt:
        nowIso()
    };
  }

  scan() {
    const dotEnv =
      loadDotEnv();

    const credentials = {};

    for (
      const [
        credentialId,
        definition
      ] of Object.entries(
        CREDENTIAL_DEFINITIONS
      )
    ) {
      credentials[
        credentialId
      ] =
        this.evaluateCredential(
          credentialId,
          definition,
          dotEnv
        );
    }

    const valid =
      Object.values(
        credentials
      ).filter(
        credential =>
          credential.status ===
          "VALID"
      );

    const partial =
      Object.values(
        credentials
      ).filter(
        credential =>
          credential.status ===
          "PARTIAL"
      );

    const missing =
      Object.values(
        credentials
      ).filter(
        credential =>
          credential.status ===
          "MISSING"
      );

    const state = {
      ok:
        missing.length === 0,

      type:
        "CREDENTIAL_AUTHORITY_STATE",

      generatedAt:
        nowIso(),

      root:
        this.root,

      envFile: {
        path:
          ENV_FILE,

        exists:
          fs.existsSync(
            ENV_FILE
          ),

        variablesDetected:
          Object.keys(
            dotEnv
          ).length
      },

      summary: {
        total:
          Object.keys(
            credentials
          ).length,

        valid:
          valid.length,

        partial:
          partial.length,

        missing:
          missing.length
      },

      credentials
    };

    this.lastState =
      state;

    safeWriteJson(
      this.stateFile,
      state
    );

    appendHistory({
      event:
        "CREDENTIAL_SCAN_COMPLETED",

      generatedAt:
        state.generatedAt,

      summary:
        state.summary
    });

    this.updateInfrastructureRegistry(
      state
    );

    return state;
  }

  updateInfrastructureRegistry(
    state
  ) {
    for (
      const credential of
      Object.values(
        state.credentials
      )
    ) {
      const infrastructureId =
        credential
          .infrastructureId;

      if (
        !infrastructureId ||
        !infrastructureRegistry
          .has(infrastructureId)
      ) {
        continue;
      }

      infrastructureRegistry
        .setCredentialState(
          infrastructureId,
          {
            status:
              credential.status,

            required:
              unique(
                credential.groups
                  .flatMap(
                    group => [
                      ...group.variables
                        .filter(
                          item =>
                            !item.optional
                        )
                        .map(
                          item =>
                            item.name
                        ),

                      ...group.files
                        .map(
                          item =>
                            item.name ||
                            item.path
                        ),

                      ...group.directories
                        .map(
                          item =>
                            item.name ||
                            item.path
                        )
                    ]
                  )
              ),

            present:
              credential.present,

            missing:
              credential.missing,

            checkedAt:
              credential.checkedAt
          }
        );
    }

    return true;
  }

  get(
    credentialId
  ) {
    const state =
      this.lastState ||
      this.scan();

    return (
      state.credentials[
        credentialId
      ] || null
    );
  }

  has(
    credentialId
  ) {
    const credential =
      this.get(
        credentialId
      );

    return Boolean(
      credential &&
      credential.ready
    );
  }

  require(
    credentialId
  ) {
    const credential =
      this.get(
        credentialId
      );

    if (!credential) {
      throw new Error(
        `Credential definition not found: ${credentialId}`
      );
    }

    if (
      !credential.ready
    ) {
      throw new Error(
        `Credential is not ready: ${credentialId}. Status: ${credential.status}.`
      );
    }

    return {
      ok: true,
      credentialId,
      status:
        credential.status,
      checkedAt:
        credential.checkedAt
    };
  }

  summary() {
    const state =
      this.lastState ||
      this.scan();

    return {
      ok:
        state.ok,

      service:
        "CredentialAuthorityService",

      status:
        state.summary.missing === 0
          ? "READY"
          : state.summary.valid > 0
            ? "PARTIAL"
            : "MISSING",

      stateFile:
        this.stateFile,

      envFile:
        state.envFile,

      summary:
        state.summary,

      credentials:
        Object.values(
          state.credentials
        ).map(
          credential => ({
            id:
              credential.id,

            infrastructureId:
              credential
                .infrastructureId,

            status:
              credential.status,

            ready:
              credential.ready,

            readyGroups:
              credential.groups
                .filter(
                  group =>
                    group.ready
                )
                .map(
                  group =>
                    group.name
                ),

            present:
              credential.present,

            missing:
              credential.missing
          })
        ),

      checkedAt:
        state.generatedAt
    };
  }

  healthCheck() {
    const summary =
      this.summary();

    return {
      ok:
        summary.status !==
        "MISSING",

      service:
        "CredentialAuthorityService",

      status:
        summary.status,

      valid:
        summary.summary.valid,

      partial:
        summary.summary.partial,

      missing:
        summary.summary.missing,

      stateFile:
        this.stateFile,

      checkedAt:
        nowIso()
    };
  }

  execute(task = {}) {
    const payload =
      task.payload ||
      task ||
      {};

    const action =
      String(
        payload.action ||
        task.action ||
        "summary"
      )
        .trim()
        .toLowerCase();

    switch (action) {
      case "scan":
      case "refresh":
        return this.scan();

      case "summary":
      case "status":
        return this.summary();

      case "health":
      case "healthcheck":
        return this.healthCheck();

      case "get":
        return {
          ok: true,
          credential:
            this.get(
              payload.id ||
              payload.credentialId
            )
        };

      case "has":
        return {
          ok: true,
          credentialId:
            payload.id ||
            payload.credentialId,
          ready:
            this.has(
              payload.id ||
              payload.credentialId
            )
        };

      case "require":
        return this.require(
          payload.id ||
          payload.credentialId
        );

      default:
        return {
          ok: false,
          status:
            "UNSUPPORTED_ACTION",
          action
        };
    }
  }
}

module.exports =
  new CredentialAuthorityService();

module.exports.CredentialAuthorityService =
  CredentialAuthorityService;