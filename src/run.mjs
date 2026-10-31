import { isAbsolute } from "node:path";
import {
  isRecord,
  validateCheckResult,
  validateSelection,
} from "./contracts.mjs";
import { resolveConfig } from "./config.mjs";
import { Error, invariant } from "./errors.mjs";
import { loadPlugin } from "./plugins.mjs";
import { fixRun } from "./fixes.mjs";

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ordered(values, key) {
  return [...values].sort((a, b) => compare(key(a), key(b)));
}

function candidateSummary(candidate) {
  return {
    id: candidate.id,
    path: candidate.path,
    ...(candidate.snapshot === undefined
      ? {}
      : {
          snapshot: {
            kind: candidate.snapshot.kind,
            id: candidate.snapshot.id,
          },
        }),
  };
}

function targetSummary(target) {
  return {
    id: target.id,
    path: target.path,
    status: target.status,
    ...(target.oldPath === undefined ? {} : { oldPath: target.oldPath }),
  };
}

function decisionSummary(decision) {
  return {
    state: decision.state,
    reason: decision.reason,
    ...(decision.path === undefined ? {} : { path: decision.path }),
    ...(decision.candidateId === undefined
      ? {}
      : { candidateId: decision.candidateId }),
  };
}

function refinement(input, output) {
  if (input === null) {
    return;
  }
  const candidates = new Set(input.candidates);
  if (input.targets !== undefined) {
    const targets = new Set(input.targets);
    invariant(
      Array.isArray(output.targets) &&
        output.targets.every((target) => targets.has(target)),
      "INCOMPATIBLE_SELECTION",
      "A filter must narrow targets by identity without discarding the target view.",
    );
  } else {
    invariant(
      output.targets === undefined,
      "INCOMPATIBLE_SELECTION",
      "Only a source may introduce selection targets.",
    );
  }
  invariant(
    output.candidates.every((candidate) => candidates.has(candidate)),
    "INCOMPATIBLE_SELECTION",
    "A filter must reuse candidates from its input, preserving identity and snapshots.",
  );
  invariant(
    Object.entries(input.capabilities).every(
      ([name, value]) =>
        Object.hasOwn(output.capabilities, name) &&
        output.capabilities[name] === value,
    ),
    "INCOMPATIBLE_SELECTION",
    "A filter must retain existing capabilities, including full inventory, without replacement.",
  );
}

function findingSummary(finding, plugin, entry, checkIndex) {
  return {
    pluginId: plugin.id,
    ruleId: finding.ruleId,
    checkIndex,
    severity: entry.severity ?? finding.severity ?? "error",
    message: finding.message,
    ...(finding.path === undefined ? {} : { path: finding.path }),
    ...(finding.paths === undefined
      ? {}
      : { paths: ordered(finding.paths, (path) => path) }),
    ...(finding.location === undefined
      ? {}
      : {
          location: {
            line: finding.location.line,
            ...(finding.location.column === undefined
              ? {}
              : { column: finding.location.column }),
          },
        }),
  };
}

function configuration(config) {
  invariant(
    isRecord(config) &&
      typeof config.root === "string" &&
      isAbsolute(config.root) &&
      typeof config.moduleRoot === "string" &&
      isAbsolute(config.moduleRoot) &&
      Array.isArray(config.files) &&
      Array.isArray(config.checks) &&
      (config.profile === null ||
        (typeof config.profile === "string" && config.profile.length > 0)) &&
      isRecord(config.source) &&
      ["file", "defaults"].includes(config.source.kind) &&
      (config.source.kind !== "file" ||
        (typeof config.source.path === "string" &&
          isAbsolute(config.source.path))),
    "INVALID_CONFIG",
    "run() requires a resolved configuration from loadConfig().",
  );
  return {
    ...resolveConfig({ files: config.files, checks: config.checks }),
    root: config.root,
    moduleRoot: config.moduleRoot,
    profile: config.profile,
    source:
      config.source.kind === "file"
        ? { kind: "file", path: config.source.path }
        : { kind: "defaults" },
  };
}

async function inspect(
  resolvedConfig,
  { fix = false, dryRun = false, precommit = false } = {},
) {
  const config = configuration(resolvedConfig);
  const errors = [];
  const findings = [];
  const stages = [];
  const checks = [];
  const identities = new Map();
  const plans = [];
  const unavailable = [];
  let fixer;
  let selection = null;
  let selectionFailed = false;

  function failure(error, phase, entry, index, plugin, candidate) {
    const detail = {
      phase,
      reference: typeof entry === "string" ? entry : entry.plugin,
      index,
      ...(plugin === undefined ? {} : { pluginId: plugin.id }),
      ...(candidate === undefined
        ? {}
        : { candidateId: candidate.id, path: candidate.path }),
      code: error instanceof Error ? error.code : "PLUGIN_EXECUTION_FAILED",
      ...(error instanceof globalThis.Error &&
      !(error instanceof Error) &&
      typeof error.code === "string"
        ? { pluginCode: error.code }
        : {}),
      message:
        error instanceof globalThis.Error
          ? error.message
          : "Plugin threw a non-Error value.",
    };
    errors.push(detail);
    return detail;
  }

  async function prepare(entry, kind) {
    const loaded = await loadPlugin(entry, kind, config.moduleRoot);
    const key = `${kind}:${loaded.plugin.id}`;
    invariant(
      !identities.has(key) || identities.get(key) === loaded.url,
      "DUPLICATE_PLUGIN_ID",
      `Different ${kind} modules declare the same id: ${loaded.plugin.id}.`,
    );
    identities.set(key, loaded.url);
    return loaded.plugin;
  }

  for (const [index, entry] of config.files.entries()) {
    const stage = {
      index,
      reference: typeof entry === "string" ? entry : entry.plugin,
    };
    stages.push(stage);
    if (selectionFailed) {
      Object.assign(stage, {
        status: "not-run",
        reason: "An earlier selection stage failed.",
      });
      continue;
    }
    let plugin;
    let phase = "load";
    try {
      const configured =
        typeof entry === "string"
          ? {
              plugin: import.meta.resolve("@svet/files-glob"),
              options: { pattern: entry },
            }
          : entry;
      plugin = await prepare(configured, "selector");
      stage.pluginId = plugin.id;
      phase = "selection";
      invariant(
        !precommit || index !== 0 || plugin.precommit === true,
        "PRECOMMIT_UNSUPPORTED",
        `Source ${plugin.id} does not support precommit selection.`,
      );
      const output = validateSelection(
        await plugin.select({
          root: config.root,
          options: configured.options,
          input: selection,
          fix,
          precommit,
        }),
      );
      if (output.fixer !== undefined) {
        invariant(
          selection === null,
          "INVALID_CONTRACT",
          "Only a source may supply a fixer.",
        );
        fixer = output.fixer;
      }
      refinement(selection, output);
      invariant(
        !precommit || output.targets !== undefined,
        "INVALID_CONTRACT",
        "Precommit selection must retain explicit change targets.",
      );
      selection = {
        ...output,
        candidates: ordered(output.candidates, (candidate) => candidate.id),
        ...(output.targets === undefined
          ? {}
          : { targets: ordered(output.targets, (target) => target.id) }),
        decisions: [
          ...(selection?.decisions ?? []),
          ...(output.decisions ?? []),
        ],
      };
      delete selection.fixer;
      Object.assign(stage, {
        status:
          selection.candidates.length || selection.targets?.length
            ? "selected"
            : "empty",
        candidates: selection.candidates.map(candidateSummary),
        ...(selection.targets === undefined
          ? {}
          : { targets: selection.targets.map(targetSummary) }),
        capabilities: Object.keys(selection.capabilities).sort(compare),
        decisions: ordered(
          (output.decisions ?? []).map(decisionSummary),
          (decision) => JSON.stringify(decision),
        ),
        ...(selection.context === undefined
          ? {}
          : { context: JSON.parse(JSON.stringify(selection.context)) }),
      });
    } catch (error) {
      failure(error, phase, entry, index, plugin);
      Object.assign(stage, { status: "failed" });
      selectionFailed = true;
      selection = null;
    }
  }

  if (precommit && !config.files.length) {
    errors.push({
      phase: "selection",
      code: "PRECOMMIT_UNSUPPORTED",
      message:
        "Precommit execution requires an explicitly configured supported source or the shipped defaults.",
    });
    selectionFailed = true;
  }

  for (const [index, entry] of config.checks.entries()) {
    const check = { index, reference: entry.plugin, outcomes: [] };
    checks.push(check);
    if (dryRun && !fix) {
      Object.assign(check, { status: "not-run", reason: "dry-run" });
      continue;
    }
    let plugin;
    try {
      plugin = await prepare(entry, "check");
      check.pluginId = plugin.id;
      check.scope = plugin.scope;
    } catch (error) {
      check.status = "failed";
      failure(error, "load", entry, index, plugin);
      continue;
    }
    const missing = (plugin.requires ?? []).filter(
      (name) =>
        selection === null || !Object.hasOwn(selection.capabilities, name),
    );
    if (missing.length) {
      Object.assign(check, {
        status: "unavailable",
        missing: missing.sort(compare),
      });
      failure(
        new Error(
          "CAPABILITY_UNAVAILABLE",
          `Required capabilities unavailable: ${missing.join(", ")}.`,
        ),
        "check",
        entry,
        index,
        plugin,
      );
      continue;
    }
    if (plugin.scope === "file" && !selection?.candidates.length) {
      Object.assign(check, {
        status: "not-run",
        reason: selectionFailed
          ? "selection-failed"
          : selection === null
            ? "no-selection"
            : "no-candidates",
      });
      continue;
    }
    for (const candidate of plugin.scope === "file"
      ? selection.candidates
      : [undefined]) {
      const outcome =
        candidate === undefined
          ? {}
          : { candidateId: candidate.id, path: candidate.path };
      check.outcomes.push(outcome);
      try {
        const result = validateCheckResult(
          await plugin.check({
            root: config.root,
            options: entry.options,
            selection,
            fix,
            ...(candidate === undefined ? {} : { candidate }),
          }),
          plugin,
        );
        if (result.skip !== undefined) {
          Object.assign(outcome, { status: "skipped", reason: result.skip });
        } else {
          findings.push(
            ...result.findings.map((finding) =>
              findingSummary(finding, plugin, entry, index),
            ),
          );
          outcome.status = "checked";
          if (fix && result.findings.length) {
            if (result.edits?.length) {
              invariant(
                selection.capabilities["content.snapshot"] === true &&
                  typeof candidate.read === "function",
                "INVALID_FIX",
                "Fixes require captured candidate.read() snapshots.",
              );
              const original = await candidate.read();
              invariant(
                original instanceof Uint8Array,
                "INVALID_FIX",
                "Fix snapshots must return Uint8Array bytes.",
              );
              plans.push({
                candidate,
                original: Buffer.from(original),
                edits: result.edits.map((edit) => ({
                  start: edit.start,
                  end: edit.end,
                  replacement: new Uint8Array(edit.replacement),
                })),
              });
            } else {
              unavailable.push({
                pluginId: plugin.id,
                ...(candidate === undefined
                  ? {}
                  : { candidateId: candidate.id, path: candidate.path }),
                status: "unavailable",
                reason: "This check does not provide fixes.",
              });
            }
          }
        }
      } catch (error) {
        outcome.status = "failed";
        failure(error, "check", entry, index, plugin, candidate);
      }
    }
    check.status = check.outcomes.some((outcome) => outcome.status === "failed")
      ? "failed"
      : check.outcomes.every((outcome) => outcome.status === "skipped")
        ? "skipped"
        : "completed";
  }

  const outcomes = checks.flatMap((check) => check.outcomes);
  const checked = outcomes.filter((outcome) => outcome.status === "checked");
  const status = errors.length
    ? "error"
    : dryRun && !fix
      ? "planned"
      : findings.length
        ? "findings"
        : checked.length
          ? "completed"
          : "empty";
  const report = {
    schemaVersion: 1,
    status,
    exitCode: errors.length ? 2 : findings.length ? 1 : 0,
    ...(dryRun && !fix ? { dryRun: true } : {}),
    ...(precommit ? { precommit: true } : {}),
    ...(status !== "empty"
      ? {}
      : {
          emptyReason: !config.checks.length
            ? "no-checks"
            : outcomes.length
              ? "all-skipped"
              : selection === null
                ? "no-selection"
                : "no-candidates",
        }),
    configuration: {
      source: config.source,
      root: config.root,
      profile: config.profile,
    },
    selection: {
      status: selectionFailed
        ? "failed"
        : selection === null
          ? "not-configured"
          : selection.candidates.length || selection.targets?.length
            ? "selected"
            : "empty",
      candidates: (selection?.candidates ?? []).map(candidateSummary),
      ...(selection?.targets === undefined
        ? {}
        : { targets: selection.targets.map(targetSummary) }),
      capabilities: Object.keys(selection?.capabilities ?? {}).sort(compare),
      stages,
    },
    checks,
    findings: ordered(findings, (finding) => JSON.stringify(finding)),
    errors,
    summary: {
      selected: selection?.candidates.length ?? 0,
      ...(precommit
        ? { selectedTargets: selection?.targets?.length ?? 0 }
        : {}),
      checkedFiles: new Set(
        checked
          .filter((outcome) => outcome.candidateId !== undefined)
          .map((outcome) => outcome.candidateId),
      ).size,
      checkedInvocations: checked.length,
      skippedInvocations: outcomes.filter(
        (outcome) => outcome.status === "skipped",
      ).length,
      failedInvocations: outcomes.filter(
        (outcome) => outcome.status === "failed",
      ).length,
      unavailableChecks: checks.filter(
        (check) => check.status === "unavailable",
      ).length,
      findings: findings.length,
    },
  };
  return { report, plans, unavailable, fixer };
}

export async function run(resolvedConfig, options = {}) {
  invariant(
    isRecord(options) &&
      Object.keys(options).every((key) =>
        ["fix", "dryRun", "precommit"].includes(key),
      ) &&
      ["fix", "dryRun", "precommit"].every(
        (key) =>
          options[key] === undefined || typeof options[key] === "boolean",
      ),
    "INVALID_CONFIG",
    "Runner options must contain only boolean fix, dryRun, and precommit fields.",
  );
  invariant(
    !(options.fix && options.precommit),
    "INVALID_CONFIG",
    "Precommit execution cannot apply fixes.",
  );
  const initial = await inspect(resolvedConfig, options);
  return options.fix
    ? fixRun(
        initial,
        async () => (await inspect(resolvedConfig)).report,
        options.dryRun ?? false,
      )
    : initial.report;
}
