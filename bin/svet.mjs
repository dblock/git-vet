#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { Error as SvetError, loadConfig, run } from "../src/index.mjs";

const help = `Usage: svet [options]

Run the checks selected by svet.config.mjs or svet.config.json.

Options:
  --config <file>       Use an explicit configuration file
  --root <directory>    Override the project root
  --profile <name>      Select a replacement configuration profile
  --format <text|json>  Output format (default: text)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 completed or intentionally empty; 1 findings; 2 errors.
No shipped default configuration is available yet.
`;

function text(value) {
  return stripVTControlCharacters(String(value)).replace(
    /\p{Cc}/gu,
    (character) =>
      `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`,
  );
}

function terminal(report) {
  const { configuration, selection, checks, summary } = report;
  const source =
    configuration.source.kind === "file"
      ? relative(configuration.root, configuration.source.path)
          .split(sep)
          .join("/")
      : "(defaults)";
  const stdout = [
    `Configuration: ${text(source)}`,
    `Profile: ${text(configuration.profile ?? "(base)")}`,
    `Files: ${selection.stages.map((stage) => `${text(stage.pluginId ?? stage.reference)} (${stage.status})`).join(" -> ") || "(none)"}`,
    `Checks: ${checks.map((check) => `${text(check.pluginId ?? check.reference)} (${check.status})`).join(", ") || "(none)"}`,
  ];
  for (const stage of selection.stages) {
    for (const decision of stage.decisions ?? []) {
      if (decision.state !== "selected") {
        stdout.push(
          `${decision.state} ${text(decision.path ?? "(project)")}: ${text(decision.reason)}`,
        );
      }
    }
  }
  for (const check of checks) {
    for (const outcome of check.outcomes) {
      if (outcome.status === "skipped") {
        stdout.push(
          `skipped ${text(outcome.path ?? "(project)")} [${text(check.pluginId)}]: ${text(outcome.reason)}`,
        );
      }
    }
  }
  for (const finding of report.findings) {
    const location = finding.location
      ? `:${finding.location.line}${finding.location.column === undefined ? "" : `:${finding.location.column}`}`
      : "";
    const paths = [
      ...(finding.path ? [`${finding.path}${location}`] : []),
      ...(finding.paths ?? []).filter((path) => path !== finding.path),
    ];
    stdout.push(
      `${text(paths.join(", ") || "(project)")}: ${finding.severity} [${text(finding.pluginId)}/${text(finding.ruleId)}]: ${text(finding.message)}`,
    );
  }
  if (report.status === "empty") {
    stdout.push(`No checks completed: ${report.emptyReason}.`);
  }
  stdout.push(
    `Selected ${summary.selected}; checked ${summary.checkedFiles}; findings ${summary.findings}; skipped ${summary.skippedInvocations}; failed ${summary.failedInvocations}; unavailable ${summary.unavailableChecks}.`,
  );
  const stderr = report.errors
    .map(
      (error) =>
        `error [${text(error.code)}${error.pluginCode ? `/${text(error.pluginCode)}` : ""}] ${text(error.phase)} ${text(error.path ?? error.pluginId ?? error.reference)}: ${text(error.message)}\n`,
    )
    .join("");
  return { stdout: `${stdout.join("\n")}\n`, stderr };
}

let format = "text";
let phase = "cli";
try {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      config: { type: "string" },
      root: { type: "string" },
      profile: { type: "string" },
      format: { type: "string", default: "text" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  format = values.format;
  if (!["text", "json"].includes(format)) {
    throw new SvetError("INVALID_ARGUMENT", "--format must be text or json.");
  }
  if (values.help) {
    process.stdout.write(help);
  } else if (values.version) {
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    process.stdout.write(`${version}\n`);
  } else {
    phase = "configuration";
    const config = await loadConfig({
      configFile: values.config,
      root: values.root,
      profile: values.profile,
    });
    phase = "execution";
    const report = await run(config);
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const output = terminal(report);
      process.stdout.write(output.stdout);
      process.stderr.write(output.stderr);
    }
    process.exitCode = report.exitCode;
  }
} catch (error) {
  const code =
    error instanceof globalThis.Error && typeof error.code === "string"
      ? error.code
      : "CLI_FAILED";
  const message =
    code === "DEFAULT_CONFIG_UNAVAILABLE"
      ? "No configuration found. Create svet.config.mjs or svet.config.json, or pass --config. Shipped defaults are not available yet."
      : error instanceof globalThis.Error
        ? error.message
        : "Unexpected non-Error failure.";
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, status: "error", exitCode: 2, errors: [{ phase, code, message }] }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`error [${text(code)}]: ${text(message)}\n`);
  }
  process.exitCode = 2;
}
