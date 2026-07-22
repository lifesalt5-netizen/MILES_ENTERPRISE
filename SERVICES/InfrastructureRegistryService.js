"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const DATA_DIR = path.join(
  ROOT,
  "DATA",
  "infrastructure"
);

const REGISTRY_FILE = path.join(
  DATA_DIR,
  "infrastructure_registry.json"
);

const HISTORY_FILE = path.join(
  DATA_DIR,
  "infrastructure_registry_history.jsonl"
);

const DEFAULT_SYSTEMS = [
  {
    id: "miles_runtime",
    name: "MILES Enterprise Runtime",
    owner: "EngineeringOwner",
    category: "runtime",
    provider: "MILES",
    systems: ["MILES Enterprise"],
    capabilities: [
      "runtime.health",
      "runtime.profile",
      "runtime.restart",
      "runtime.repair",
      "runtime.validate",
      "runtime.rollback"
    ],
    authority: {
      read: true,
      write: true,
      execute: true,
      admin: true,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForDelete: true,
      approvalRequiredForArchitectureChange: true
    }
  },

  {
    id: "orion",
    name: "ORION Intelligence",
    owner: "OrionOwner",
    category: "intelligence",
    provider: "OrionProvider",
    systems: ["ORION", "SQLite"],
    capabilities: [
      "orion.health",
      "orion.contractors.read",
      "orion.buyers.read",
      "orion.opportunities.read",
      "orion.recompetes.read",
      "orion.recommendations.read",
      "orion.personas.read"
    ],
    authority: {
      read: true,
      write: false,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForWrite: true,
      approvalRequiredForDelete: true,
      approvalRequiredForSchemaChange: true
    }
  },

  {
    id: "instantly",
    name: "Instantly",
    owner: "InstantlyOwner",
    category: "marketing",
    provider: "MarketingProvider",
    systems: ["Instantly"],
    capabilities: [
      "instantly.health",
      "instantly.campaigns.read",
      "instantly.campaigns.create",
      "instantly.campaigns.update",
      "instantly.campaigns.pause",
      "instantly.campaigns.resume",
      "instantly.mailboxes.read",
      "instantly.mailboxes.manage",
      "instantly.replies.read",
      "instantly.replies.classify",
      "instantly.leads.upload",
      "instantly.leads.remove",
      "instantly.segments.manage",
      "instantly.deliverability.audit",
      "instantly.warmup.monitor"
    ],
    authority: {
      read: true,
      write: false,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForSend: true,
      approvalRequiredForDelete: true,
      approvalRequiredForCampaignLaunch: true
    }
  },

  {
    id: "google_workspace",
    name: "Google Workspace",
    owner: "GoogleWorkspaceOwner",
    category: "productivity",
    provider: "GoogleWorkspaceProvider",
    systems: [
      "Gmail",
      "Google Calendar",
      "Google Drive",
      "Google Docs",
      "Google Sheets",
      "Google Contacts"
    ],
    capabilities: [
      "gmail.read",
      "gmail.classify",
      "gmail.draft",
      "gmail.send",
      "calendar.read",
      "calendar.create",
      "calendar.update",
      "calendar.cancel",
      "drive.read",
      "drive.organize",
      "drive.upload",
      "docs.read",
      "docs.create",
      "docs.update",
      "sheets.read",
      "sheets.create",
      "sheets.update",
      "contacts.read"
    ],
    authority: {
      read: true,
      write: false,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForSend: true,
      approvalRequiredForDelete: true,
      approvalRequiredForExternalShare: true
    }
  },

  {
    id: "website",
    name: "P2GC Website",
    owner: "WebsiteOwner",
    category: "digital_presence",
    provider: "WebsiteProvider",
    systems: ["B12", "IONOS Website"],
    capabilities: [
      "website.health",
      "website.pages.read",
      "website.pages.update",
      "website.forms.read",
      "website.forms.update",
      "website.links.audit",
      "website.seo.audit",
      "website.analytics.read",
      "website.publish"
    ],
    authority: {
      read: true,
      write: false,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForPublish: true,
      approvalRequiredForDelete: true,
      approvalRequiredForBrandChange: true
    }
  },

  {
    id: "domains",
    name: "P2GC Domains and DNS",
    owner: "DomainOwner",
    category: "infrastructure",
    provider: "DomainProvider",
    systems: ["Namecheap", "IONOS", "DNS"],
    capabilities: [
      "domains.inventory",
      "domains.expiration.read",
      "domains.dns.read",
      "domains.dns.update",
      "domains.spf.audit",
      "domains.dkim.audit",
      "domains.dmarc.audit",
      "domains.mx.audit",
      "domains.ssl.audit",
      "domains.redirects.audit"
    ],
    authority: {
      read: true,
      write: false,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForDnsChange: true,
      approvalRequiredForRegistrarChange: true,
      approvalRequiredForDelete: true,
      approvalRequiredForTransfer: true
    }
  },

  {
    id: "filesystem_c",
    name: "Windows C Drive",
    owner: "FileSystemOwner",
    category: "filesystem",
    provider: "FileSystemProvider",
    systems: ["C:\\"],
    capabilities: [
      "filesystem.read",
      "filesystem.inventory",
      "filesystem.search",
      "filesystem.classify",
      "filesystem.health",
      "filesystem.temp.cleanup"
    ],
    authority: {
      read: true,
      write: false,
      execute: false,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForWrite: true,
      approvalRequiredForDelete: true,
      systemDirectoriesProtected: true
    }
  },

  {
    id: "filesystem_d",
    name: "P2GC D Drive",
    owner: "FileSystemOwner",
    category: "filesystem",
    provider: "FileSystemProvider",
    systems: ["D:\\"],
    capabilities: [
      "filesystem.read",
      "filesystem.write",
      "filesystem.inventory",
      "filesystem.search",
      "filesystem.classify",
      "filesystem.backup",
      "filesystem.restore",
      "filesystem.organize",
      "filesystem.duplicates.detect",
      "filesystem.health"
    ],
    authority: {
      read: true,
      write: true,
      execute: true,
      admin: false,
      delete: false
    },
    protection: {
      protected: true,
      approvalRequiredForDelete: true,
      approvalRequiredForMassMove: true,
      authoritativeFoldersProtected: true
    }
  }
];

function ensureDir(directory) {
  fs.mkdirSync(directory, {
    recursive: true
  });
}

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function safeReadJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const text = fs
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "");

    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function safeWriteJson(file, value) {
  ensureDir(path.dirname(file));

  const temporaryFile =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(value, null, 2),
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
  ensureDir(path.dirname(HISTORY_FILE));

  fs.appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .map(value =>
          String(value).trim()
        )
        .filter(Boolean)
    )
  );
}

function normalizeAuthority(authority = {}) {
  return {
    read:
      authority.read === true,

    write:
      authority.write === true,

    execute:
      authority.execute === true,

    admin:
      authority.admin === true,

    delete:
      authority.delete === true
  };
}

function normalizeHealth(health = {}) {
  const score = Math.max(
    0,
    Math.min(
      100,
      safeNumber(
        health.score,
        0
      )
    )
  );

  return {
    status:
      health.status ||
      (
        score >= 90
          ? "HEALTHY"
          : score >= 70
            ? "WATCH"
            : score > 0
              ? "DEGRADED"
              : "UNKNOWN"
      ),

    score,

    checkedAt:
      health.checkedAt ||
      null,

    message:
      health.message ||
      null,

    checks:
      Array.isArray(health.checks)
        ? health.checks
        : []
  };
}

function normalizeCredentialState(
  credentials = {}
) {
  return {
    status:
      credentials.status ||
      "UNKNOWN",

    required:
      uniqueStrings(
        credentials.required || []
      ),

    present:
      uniqueStrings(
        credentials.present || []
      ),

    missing:
      uniqueStrings(
        credentials.missing || []
      ),

    expiresAt:
      credentials.expiresAt ||
      null,

    checkedAt:
      credentials.checkedAt ||
      null
  };
}

function defaultRuntimeState() {
  return {
    status: "REGISTERED",
    enabled: true,
    ready: false,
    lastCheck: null,
    lastSuccess: null,
    lastFailure: null,
    failures: 0,
    activeOperations: 0
  };
}

function normalizeSystem(system = {}) {
  const id = normalizeId(
    system.id ||
    system.name
  );

  if (!id) {
    throw new Error(
      "Infrastructure system requires an id or name."
    );
  }

  return {
    id,

    name:
      system.name ||
      id,

    owner:
      system.owner ||
      "MILES",

    category:
      system.category ||
      "general",

    provider:
      system.provider ||
      null,

    systems:
      uniqueStrings(
        system.systems || []
      ),

    capabilities:
      uniqueStrings(
        system.capabilities || []
      ),

    authority:
      normalizeAuthority(
        system.authority || {}
      ),

    protection: {
      protected:
        system.protection
          ?.protected !== false,

      ...(
        system.protection || {}
      )
    },

    credentials:
      normalizeCredentialState(
        system.credentials || {}
      ),

    health:
      normalizeHealth(
        system.health || {}
      ),

    runtime: {
      ...defaultRuntimeState(),
      ...(
        system.runtime || {}
      )
    },

    metadata:
      system.metadata &&
      typeof system.metadata ===
        "object"
        ? system.metadata
        : {},

    createdAt:
      system.createdAt ||
      nowIso(),

    updatedAt:
      system.updatedAt ||
      nowIso()
  };
}

class InfrastructureRegistryService {
  constructor(options = {}) {
    this.root =
      options.root ||
      ROOT;

    this.registryFile =
      options.registryFile ||
      REGISTRY_FILE;

    this.historyFile =
      options.historyFile ||
      HISTORY_FILE;

    this.registry = {
      version: 1,
      type:
        "MILES_INFRASTRUCTURE_REGISTRY",
      generatedAt:
        nowIso(),
      updatedAt:
        nowIso(),
      systems: {}
    };

    this.load();
    this.installDefaults();
  }

  load() {
    const existing =
      safeReadJson(
        this.registryFile,
        null
      );

    if (
      existing &&
      existing.systems &&
      typeof existing.systems ===
        "object"
    ) {
      this.registry = {
        version:
          existing.version || 1,

        type:
          "MILES_INFRASTRUCTURE_REGISTRY",

        generatedAt:
          existing.generatedAt ||
          nowIso(),

        updatedAt:
          existing.updatedAt ||
          nowIso(),

        systems:
          existing.systems
      };
    }

    return this.registry;
  }

  save(
    event = "REGISTRY_SAVED",
    details = {}
  ) {
    this.registry.updatedAt =
      nowIso();

    safeWriteJson(
      this.registryFile,
      this.registry
    );

    appendHistory({
      event,
      details,
      generatedAt:
        nowIso()
    });

    return true;
  }

  installDefaults() {
    let installed = 0;
    let updated = 0;

    for (
      const defaultSystem of
      DEFAULT_SYSTEMS
    ) {
      const normalized =
        normalizeSystem(
          defaultSystem
        );

      const current =
        this.registry.systems[
          normalized.id
        ];

      if (!current) {
        this.registry.systems[
          normalized.id
        ] = normalized;

        installed += 1;
        continue;
      }

      this.registry.systems[
        normalized.id
      ] = normalizeSystem({
        ...normalized,
        ...current,

        capabilities:
          uniqueStrings([
            ...normalized.capabilities,
            ...(current.capabilities || [])
          ]),

        systems:
          uniqueStrings([
            ...normalized.systems,
            ...(current.systems || [])
          ]),

        authority: {
          ...normalized.authority,
          ...(current.authority || {})
        },

        protection: {
          ...normalized.protection,
          ...(current.protection || {})
        },

        credentials: {
          ...normalized.credentials,
          ...(current.credentials || {})
        },

        health: {
          ...normalized.health,
          ...(current.health || {})
        },

        runtime: {
          ...normalized.runtime,
          ...(current.runtime || {})
        },

        metadata: {
          ...normalized.metadata,
          ...(current.metadata || {})
        },

        createdAt:
          current.createdAt ||
          normalized.createdAt,

        updatedAt:
          current.updatedAt ||
          normalized.updatedAt
      });

      updated += 1;
    }

    this.save(
      "DEFAULT_SYSTEMS_INSTALLED",
      {
        installed,
        updated
      }
    );

    return {
      ok: true,
      installed,
      updated
    };
  }

  register(system = {}) {
    const normalized =
      normalizeSystem(system);

    const existing =
      this.registry.systems[
        normalized.id
      ];

    this.registry.systems[
      normalized.id
    ] = existing
      ? normalizeSystem({
          ...existing,
          ...normalized,

          capabilities:
            uniqueStrings([
              ...(existing.capabilities || []),
              ...normalized.capabilities
            ]),

          systems:
            uniqueStrings([
              ...(existing.systems || []),
              ...normalized.systems
            ]),

          authority: {
            ...(existing.authority || {}),
            ...normalized.authority
          },

          protection: {
            ...(existing.protection || {}),
            ...normalized.protection
          },

          credentials: {
            ...(existing.credentials || {}),
            ...normalized.credentials
          },

          health: {
            ...(existing.health || {}),
            ...normalized.health
          },

          runtime: {
            ...(existing.runtime || {}),
            ...normalized.runtime
          },

          metadata: {
            ...(existing.metadata || {}),
            ...normalized.metadata
          },

          createdAt:
            existing.createdAt,

          updatedAt:
            nowIso()
        })
      : normalized;

    this.save(
      existing
        ? "SYSTEM_UPDATED"
        : "SYSTEM_REGISTERED",
      {
        id: normalized.id
      }
    );

    return clone(
      this.registry.systems[
        normalized.id
      ]
    );
  }

  get(id) {
    const normalizedId =
      normalizeId(id);

    const system =
      this.registry.systems[
        normalizedId
      ];

    return system
      ? clone(system)
      : null;
  }

  list(filters = {}) {
    let systems =
      Object.values(
        this.registry.systems
      );

    if (filters.category) {
      systems = systems.filter(
        system =>
          system.category ===
          filters.category
      );
    }

    if (filters.owner) {
      systems = systems.filter(
        system =>
          system.owner ===
          filters.owner
      );
    }

    if (filters.provider) {
      systems = systems.filter(
        system =>
          system.provider ===
          filters.provider
      );
    }

    if (
      filters.enabled !==
      undefined
    ) {
      systems = systems.filter(
        system =>
          Boolean(
            system.runtime
              ?.enabled
          ) ===
          Boolean(
            filters.enabled
          )
      );
    }

    return clone(
      systems.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      )
    );
  }

  has(id) {
    return Boolean(
      this.registry.systems[
        normalizeId(id)
      ]
    );
  }

  update(id, patch = {}) {
    const normalizedId =
      normalizeId(id);

    const current =
      this.registry.systems[
        normalizedId
      ];

    if (!current) {
      throw new Error(
        `Infrastructure system is not registered: ${id}`
      );
    }

    const updated =
      normalizeSystem({
        ...current,
        ...patch,

        id:
          normalizedId,

        capabilities:
          patch.capabilities
            ? uniqueStrings(
                patch.capabilities
              )
            : current.capabilities,

        systems:
          patch.systems
            ? uniqueStrings(
                patch.systems
              )
            : current.systems,

        authority: {
          ...current.authority,
          ...(patch.authority || {})
        },

        protection: {
          ...current.protection,
          ...(patch.protection || {})
        },

        credentials: {
          ...current.credentials,
          ...(patch.credentials || {})
        },

        health: {
          ...current.health,
          ...(patch.health || {})
        },

        runtime: {
          ...current.runtime,
          ...(patch.runtime || {})
        },

        metadata: {
          ...current.metadata,
          ...(patch.metadata || {})
        },

        createdAt:
          current.createdAt,

        updatedAt:
          nowIso()
      });

    this.registry.systems[
      normalizedId
    ] = updated;

    this.save(
      "SYSTEM_PATCHED",
      {
        id:
          normalizedId,

        fields:
          Object.keys(patch)
      }
    );

    return clone(updated);
  }

  registerCapability(
    id,
    capability
  ) {
    const current =
      this.get(id);

    if (!current) {
      throw new Error(
        `Infrastructure system is not registered: ${id}`
      );
    }

    return this.update(
      id,
      {
        capabilities:
          uniqueStrings([
            ...current.capabilities,
            capability
          ])
      }
    );
  }

  setAuthority(
    id,
    authority = {}
  ) {
    return this.update(
      id,
      {
        authority:
          normalizeAuthority({
            ...(
              this.get(id)
                ?.authority || {}
            ),
            ...authority
          })
      }
    );
  }

  setCredentialState(
    id,
    credentials = {}
  ) {
    const current =
      this.get(id);

    return this.update(
      id,
      {
        credentials:
          normalizeCredentialState({
            ...(
              current?.credentials ||
              {}
            ),
            ...credentials,
            checkedAt:
              credentials.checkedAt ||
              nowIso()
          })
      }
    );
  }

  setHealth(
    id,
    health = {}
  ) {
    const current =
      this.get(id);

    const normalizedHealth =
      normalizeHealth({
        ...(
          current?.health || {}
        ),
        ...health,
        checkedAt:
          health.checkedAt ||
          nowIso()
      });

    const ready =
      normalizedHealth.score >= 70 &&
      ![
        "CRITICAL",
        "FAILED",
        "OFFLINE"
      ].includes(
        String(
          normalizedHealth.status
        ).toUpperCase()
      );

    return this.update(
      id,
      {
        health:
          normalizedHealth,

        runtime: {
          ...(
            current?.runtime || {}
          ),
          ready,
          lastCheck:
            normalizedHealth
              .checkedAt,

          lastSuccess:
            ready
              ? normalizedHealth
                  .checkedAt
              : current?.runtime
                  ?.lastSuccess ||
                null,

          lastFailure:
            ready
              ? current?.runtime
                  ?.lastFailure ||
                null
              : normalizedHealth
                  .checkedAt,

          failures:
            ready
              ? safeNumber(
                  current?.runtime
                    ?.failures,
                  0
                )
              : safeNumber(
                  current?.runtime
                    ?.failures,
                  0
                ) + 1
        }
      }
    );
  }

  beginOperation(id) {
    const current =
      this.get(id);

    if (!current) {
      throw new Error(
        `Infrastructure system is not registered: ${id}`
      );
    }

    return this.update(
      id,
      {
        runtime: {
          ...current.runtime,
          activeOperations:
            safeNumber(
              current.runtime
                ?.activeOperations,
              0
            ) + 1
        }
      }
    );
  }

  endOperation(
    id,
    outcome = {}
  ) {
    const current =
      this.get(id);

    if (!current) {
      throw new Error(
        `Infrastructure system is not registered: ${id}`
      );
    }

    const success =
      outcome.ok !== false;

    return this.update(
      id,
      {
        runtime: {
          ...current.runtime,

          activeOperations:
            Math.max(
              0,
              safeNumber(
                current.runtime
                  ?.activeOperations,
                0
              ) - 1
            ),

          lastSuccess:
            success
              ? nowIso()
              : current.runtime
                  ?.lastSuccess ||
                null,

          lastFailure:
            success
              ? current.runtime
                  ?.lastFailure ||
                null
              : nowIso(),

          failures:
            success
              ? safeNumber(
                  current.runtime
                    ?.failures,
                  0
                )
              : safeNumber(
                  current.runtime
                    ?.failures,
                  0
                ) + 1
        }
      }
    );
  }

  can(
    id,
    authorityName
  ) {
    const system =
      this.get(id);

    if (!system) {
      return {
        allowed: false,
        reason:
          "SYSTEM_NOT_REGISTERED"
      };
    }

    const authorityKey =
      String(
        authorityName || ""
      )
        .trim()
        .toLowerCase();

    if (
      !Object.prototype
        .hasOwnProperty.call(
          system.authority,
          authorityKey
        )
    ) {
      return {
        allowed: false,
        reason:
          "UNKNOWN_AUTHORITY",
        system
      };
    }

    const allowed =
      system.authority[
        authorityKey
      ] === true;

    return {
      allowed,

      reason:
        allowed
          ? "AUTHORIZED"
          : "NOT_AUTHORIZED",

      systemId:
        system.id,

      authority:
        authorityKey,

      protected:
        Boolean(
          system.protection
            ?.protected
        )
    };
  }

  summary() {
    const systems =
      this.list();

    const healthy =
      systems.filter(
        system =>
          system.health.score >= 90
      );

    const ready =
      systems.filter(
        system =>
          system.runtime.ready === true
      );

    const credentialReady =
      systems.filter(
        system =>
          system.credentials.status ===
          "VALID"
      );

    const degraded =
      systems.filter(
        system =>
          [
            "DEGRADED",
            "CRITICAL",
            "FAILED",
            "OFFLINE"
          ].includes(
            String(
              system.health.status
            ).toUpperCase()
          )
      );

    return {
      ok:
        degraded.length === 0,

      type:
        "INFRASTRUCTURE_REGISTRY_SUMMARY",

      generatedAt:
        nowIso(),

      totals: {
        systems:
          systems.length,

        ready:
          ready.length,

        healthy:
          healthy.length,

        credentialReady:
          credentialReady.length,

        degraded:
          degraded.length,

        protected:
          systems.filter(
            system =>
              system.protection
                ?.protected === true
          ).length,

        activeOperations:
          systems.reduce(
            (
              total,
              system
            ) =>
              total +
              safeNumber(
                system.runtime
                  ?.activeOperations,
                0
              ),
            0
          )
      },

      readySystems:
        ready.map(
          system =>
            system.id
        ),

      degradedSystems:
        degraded.map(
          system => ({
            id:
              system.id,

            status:
              system.health.status,

            score:
              system.health.score,

            message:
              system.health.message
          })
        ),

      systems:
        systems.map(
          system => ({
            id:
              system.id,

            name:
              system.name,

            owner:
              system.owner,

            provider:
              system.provider,

            health:
              system.health,

            credentials:
              system.credentials.status,

            ready:
              system.runtime.ready,

            authority:
              system.authority
          })
        )
    };
  }

  execute(task = {}) {
    const payload =
      task.payload ||
      task ||
      {};

    const action =
      payload.action ||
      task.action ||
      "summary";

    switch (
      String(action)
        .trim()
        .toLowerCase()
    ) {
      case "summary":
      case "status":
      case "health":
        return this.summary();

      case "list":
        return {
          ok: true,
          systems:
            this.list(
              payload.filters || {}
            )
        };

      case "get":
        return {
          ok: true,
          system:
            this.get(
              payload.id
            )
        };

      case "register":
        return {
          ok: true,
          system:
            this.register(
              payload.system ||
              payload
            )
        };

      case "update":
        return {
          ok: true,
          system:
            this.update(
              payload.id,
              payload.patch || {}
            )
        };

      case "can":
        return {
          ok: true,
          authority:
            this.can(
              payload.id,
              payload.authority
            )
        };

      default:
        return {
          ok: false,
          status:
            "UNSUPPORTED_ACTION",
          action
        };
    }
  }

  healthCheck() {
    const summary =
      this.summary();

    return {
      ok:
        summary.ok,

      service:
        "InfrastructureRegistryService",

      status:
        summary.ok
          ? "HEALTHY"
          : "WATCH",

      registryFile:
        this.registryFile,

      systems:
        summary.totals.systems,

      ready:
        summary.totals.ready,

      degraded:
        summary.totals.degraded,

      checkedAt:
        nowIso()
    };
  }
}

module.exports =
  new InfrastructureRegistryService();

module.exports.InfrastructureRegistryService =
  InfrastructureRegistryService;