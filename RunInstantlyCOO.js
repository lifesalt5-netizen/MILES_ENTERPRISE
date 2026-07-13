'use strict';

/*
  MILES Enterprise
  File: RunInstantlyCOO.js
  Version: 1.0.0

  Purpose:
  - Execute one read-only Instantly COO operational review.
  - Write current JSON and Markdown reports.
*/

const path = require('path');

const InstantlyCOOService = require(
  './SERVICES/digital_coo/InstantlyCOOService'
);

async function main() {
  const rootDir =
    process.env.MILES_ROOT
      ? path.resolve(
          process.env.MILES_ROOT
        )
      : __dirname;

  const service =
    new InstantlyCOOService({
      rootDir
    });

  const health =
    await service.healthCheck();

  console.log(
    '============================================================'
  );

  console.log(
    'MILES INSTANTLY COO — HEALTH'
  );

  console.log(
    '============================================================'
  );

  console.log(
    JSON.stringify(
      health,
      null,
      2
    )
  );

  if (!health.ok) {
    throw new Error(
      health.error ||
      'Instantly COO health check failed.'
    );
  }

  const snapshot =
    await service.generateSnapshot();

  console.log(
    '============================================================'
  );

  console.log(
    'MILES INSTANTLY COO — SNAPSHOT COMPLETE'
  );

  console.log(
    '============================================================'
  );

  console.log(
    JSON.stringify(
      {
        ok:
          snapshot.ok,
        service:
          snapshot.service,
        version:
          snapshot.version,
        status:
          snapshot.status,
        summary:
          snapshot.summary,
        recommendations:
          snapshot.recommendations,
        errors:
          snapshot.errors
      },
      null,
      2
    )
  );

  console.log('');
  console.log(
    `JSON: ${path.join(rootDir, 'runtime', 'instantly_coo', 'instantly_coo_latest.json')}`
  );

  console.log(
    `REPORT: ${path.join(rootDir, 'runtime', 'instantly_coo', 'instantly_coo_latest.md')}`
  );
}

main()
  .catch(error => {
    console.error(
      'MILES INSTANTLY COO FAILED'
    );

    console.error(
      error.stack ||
      error.message
    );

    process.exitCode = 1;
  });