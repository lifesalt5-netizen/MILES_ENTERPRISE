"use strict";

const path = require("path");
const RepositoryUnderstandingService =
  require("../SERVICES/engineering/RepositoryUnderstandingService");

function parseArguments(argv) {
  return {
    apply: argv.includes("--apply"),
    output: (
      argv.find(value => value.startsWith("--output=")) || ""
    ).slice("--output=".length) || null
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const root =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");

  const service = new RepositoryUnderstandingService({
    rootDir: root,
    outputFile: args.output
      ? path.resolve(args.output)
      : undefined
  });

  const graph = service.buildGraph();

  if (!args.apply) {
    console.log(JSON.stringify({
      ok: graph.ok,
      mode: "PLAN_ONLY",
      service: graph.service,
      root: graph.root,
      fingerprint: graph.fingerprint,
      summary: graph.summary,
      validation: graph.validation,
      outputFile: service.outputFile
    }, null, 2));

    console.log(
      "\nPLAN ONLY. Re-run with --apply to persist the dependency graph."
    );
    return graph;
  }

  const artifact = service.writeGraph(graph);

  console.log(JSON.stringify({
    ok: true,
    mode: "APPLY",
    service: graph.service,
    fingerprint: graph.fingerprint,
    summary: graph.summary,
    validation: graph.validation,
    artifact
  }, null, 2));

  return {
    graph,
    artifact
  };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArguments,
  main
};
