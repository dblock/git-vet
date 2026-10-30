import { invariant } from "./errors.mjs";

export const PLUGIN_API_VERSION = 1;
const identifier = /^[a-z][a-z0-9]*(?:[./-][a-z0-9]+)*$/u;

export function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function assert(condition, message) {
  invariant(condition, "INVALID_CONTRACT", message);
}

function text(value) {
  return typeof value === "string" && value.length > 0;
}

function identifiers(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && identifier.test(item)) &&
    new Set(value).size === value.length
  );
}

function strings(value) {
  return Array.isArray(value) && value.every(text);
}

function json(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if ((!Array.isArray(value) && !isRecord(value)) || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Object.values(value).every((item) => json(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export function validatePlugin(plugin, kind) {
  assert(
    ["selector", "check"].includes(kind),
    "Unknown requested plugin kind.",
  );
  assert(isRecord(plugin), "A plugin must default-export an object.");
  assert(
    plugin.apiVersion === PLUGIN_API_VERSION,
    `Unsupported plugin API version; expected ${PLUGIN_API_VERSION}.`,
  );
  assert(
    typeof plugin.id === "string" && identifier.test(plugin.id),
    "A plugin must declare a stable lowercase id.",
  );
  assert(plugin.kind === kind, `Plugin ${plugin.id} must have kind "${kind}".`);
  assert(
    plugin.validateOptions === undefined ||
      typeof plugin.validateOptions === "function",
    `Plugin ${plugin.id} validateOptions must be a function.`,
  );
  if (kind === "selector") {
    assert(
      typeof plugin.select === "function",
      `Selector ${plugin.id} must implement select().`,
    );
  } else {
    assert(
      plugin.fixable === undefined ||
        (typeof plugin.fixable === "boolean" &&
          (!plugin.fixable || plugin.scope === "file")),
      "Only file checks may declare fixable: true.",
    );
    assert(
      ["file", "project"].includes(plugin.scope),
      `Check ${plugin.id} must declare file or project scope.`,
    );
    assert(
      identifiers(plugin.rules) && plugin.rules.length > 0,
      `Check ${plugin.id} must declare distinct stable rule ids.`,
    );
    assert(
      plugin.requires === undefined || identifiers(plugin.requires),
      `Check ${plugin.id} requires must contain distinct capability ids.`,
    );
    assert(
      typeof plugin.check === "function",
      `Check ${plugin.id} must implement check().`,
    );
  }
  return plugin;
}

export function validateSelection(selection) {
  assert(isRecord(selection), "A selector must return a selection object.");
  assert(
    selection.fixer === undefined ||
      (isRecord(selection.fixer) &&
        typeof selection.fixer.validate === "function" &&
        typeof selection.fixer.apply === "function"),
    "A source fixer must provide validate() and apply().",
  );
  assert(
    Array.isArray(selection.candidates),
    "A selection must contain a candidates array.",
  );
  const ids = new Set();
  for (const candidate of selection.candidates) {
    assert(
      isRecord(candidate) && text(candidate.id) && text(candidate.path),
      "Each candidate must have a nonempty id and path.",
    );
    assert(!ids.has(candidate.id), `Duplicate candidate id: ${candidate.id}.`);
    ids.add(candidate.id);
    assert(
      candidate.read === undefined || typeof candidate.read === "function",
      `Candidate ${candidate.id} read must be a function.`,
    );
    assert(
      candidate.metadata === undefined || isRecord(candidate.metadata),
      `Candidate ${candidate.id} metadata must be an object.`,
    );
    if (candidate.snapshot !== undefined) {
      assert(
        isRecord(candidate.snapshot) &&
          text(candidate.snapshot.id) &&
          text(candidate.snapshot.kind),
        `Candidate ${candidate.id} snapshot must have an id and kind.`,
      );
    }
  }
  assert(
    isRecord(selection.capabilities),
    "A selection must declare its capabilities object, even when empty.",
  );
  assert(
    Object.entries(selection.capabilities).every(
      ([key, value]) => identifier.test(key) && value !== undefined,
    ),
    "Capability names must be stable ids and values must not be undefined.",
  );
  assert(
    selection.context === undefined ||
      (isRecord(selection.context) && json(selection.context)),
    "Selection context must be a JSON-safe object.",
  );
  if (selection.decisions !== undefined) {
    assert(Array.isArray(selection.decisions), "Decisions must be an array.");
    for (const decision of selection.decisions) {
      assert(
        isRecord(decision) &&
          ["selected", "filtered", "excluded", "unavailable"].includes(
            decision.state,
          ) &&
          text(decision.reason) &&
          (decision.path === undefined || text(decision.path)) &&
          (decision.candidateId === undefined || text(decision.candidateId)),
        "Each selection decision must have a supported state and reason.",
      );
    }
  }
  return selection;
}

export function validateCheckResult(result, plugin) {
  assert(isRecord(result), `Check ${plugin.id} must return a result object.`);
  const skipped = Object.hasOwn(result, "skip");
  assert(
    skipped
      ? text(result.skip) && !Object.hasOwn(result, "findings")
      : Array.isArray(result.findings),
    `Check ${plugin.id} must return findings or a nonempty skip reason, not both.`,
  );
  if (skipped) {
    assert(result.edits === undefined, "Skipped checks cannot propose edits.");
    return result;
  }
  if (result.edits !== undefined) {
    assert(
      plugin.fixable === true && plugin.scope === "file",
      "Only fixable file checks may propose edits.",
    );
    assert(Array.isArray(result.edits), "Fix edits must be an array.");
    assert(
      result.edits.length === 0 || result.findings.length > 0,
      "Fix edits require findings.",
    );
    for (const edit of result.edits) {
      assert(
        isRecord(edit) &&
          Object.keys(edit).every((key) =>
            ["start", "end", "replacement"].includes(key),
          ) &&
          Number.isSafeInteger(edit.start) &&
          edit.start >= 0 &&
          Number.isSafeInteger(edit.end) &&
          edit.end >= edit.start &&
          edit.replacement instanceof Uint8Array &&
          (edit.end > edit.start || edit.replacement.length > 0),
        "Fix edits require valid byte ranges and Uint8Array replacements, without paths.",
      );
    }
  }
  for (const finding of result.findings) {
    assert(
      isRecord(finding) &&
        plugin.rules.includes(finding.ruleId) &&
        text(finding.message),
      `Check ${plugin.id} findings must name a declared rule and message.`,
    );
    assert(
      finding.severity === undefined ||
        ["error", "warning"].includes(finding.severity),
      "Finding severity must be error or warning.",
    );
    assert(
      (finding.path === undefined || text(finding.path)) &&
        (finding.paths === undefined || strings(finding.paths)),
      "Finding paths must be nonempty strings.",
    );
    if (finding.location !== undefined) {
      assert(
        isRecord(finding.location) &&
          Number.isInteger(finding.location.line) &&
          finding.location.line > 0 &&
          (finding.location.column === undefined ||
            (Number.isInteger(finding.location.column) &&
              finding.location.column > 0)),
        "Finding locations must use positive one-based line/column numbers.",
      );
      assert(text(finding.path), "A finding location requires a path.");
    }
  }
  return result;
}
