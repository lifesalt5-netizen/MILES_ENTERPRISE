"use strict";

const service =
  require(
    "./SERVICES/WorkPackageQueueReconciliationService"
  );

function argumentValue(prefix) {
  const argument =
    process.argv.find(item =>
      item.startsWith(prefix)
    );

  if (!argument) {
    return null;
  }

  return argument.slice(
    prefix.length
  );
}

const apply =
  process.argv.includes(
    "--apply"
  );

const maxValue =
  argumentValue(
    "--max="
  );

const maxPackages =
  maxValue === null
    ? 25
    : Number(maxValue);

try {
  const result =
    service.reconcile({
      apply,
      maxPackages
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (result.ok === false) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "[BUILD134] Reconciliation failed:",
    error.stack ||
    error.message
  );

  process.exitCode = 1;
}
