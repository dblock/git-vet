import { isAbsolute } from "node:path";
import picomatch from "picomatch";
import { pathInventory } from "svet-files-glob/inventory";

function record(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function fields(value, allowed) {
  if (!record(value)) throw new Error("Path case options must be objects.");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new Error(`Unknown path case option: ${key}.`);
  }
}

function policy(options, inherited = { case: "lower", exceptions: [] }) {
  fields(options, ["case", "exceptions"]);
  const casing = options.case === undefined ? inherited.case : options.case;
  if (!["lower", "upper"].includes(casing)) {
    throw new Error("Path case must be lower or upper.");
  }
  const exceptions =
    options.exceptions === undefined
      ? inherited.exceptions
      : options.exceptions;
  if (!Array.isArray(exceptions)) {
    throw new Error(
      "Path case exceptions must be an array of positive, root-relative POSIX globs.",
    );
  }
  const matches = [];
  for (const pattern of exceptions) {
    if (
      typeof pattern !== "string" ||
      !pattern.trim() ||
      !pattern.isWellFormed() ||
      isAbsolute(pattern) ||
      /^[a-zA-Z]:/.test(pattern) ||
      pattern.split("/").includes("..") ||
      picomatch.scan(pattern).negated
    ) {
      throw new Error(
        "Path case exceptions must be an array of positive, root-relative POSIX globs.",
      );
    }
    matches.push(
      picomatch(pattern, { dot: true, windows: false, strictBrackets: true }),
    );
  }
  return { case: casing, exceptions, matches };
}

function settings(options) {
  fields(options, ["case", "exceptions", "files", "directories"]);
  const shared = policy({ case: options.case, exceptions: options.exceptions });
  const result = {};
  for (const kind of ["files", "directories"]) {
    result[kind] =
      options[kind] === false
        ? false
        : policy(options[kind] === undefined ? {} : options[kind], shared);
  }
  if (!result.files && !result.directories) {
    throw new Error(
      "At least one path case category must be enabled; omit the check to disable both.",
    );
  }
  return result;
}

export default {
  apiVersion: 1,
  id: "path/case",
  kind: "check",
  scope: "project",
  rules: ["case"],
  requires: ["fs.inventory"],
  validateOptions(options) {
    settings(options);
  },
  async check({ selection, options = {} }) {
    const configured = settings(options);
    const findings = [];
    for (const entry of pathInventory(selection)) {
      const directory = entry.kind === "directory";
      const rule = configured[directory ? "directories" : "files"];
      if (!rule || rule.matches.some((matches) => matches(entry.path)))
        continue;
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      const expected =
        rule.case === "lower" ? name.toLowerCase() : name.toUpperCase();
      if (name !== expected) {
        findings.push({
          ruleId: "case",
          path: entry.path,
          message: `${directory ? "Directory name" : "Filename"} must be ${rule.case}case.`,
        });
      }
    }
    return { findings };
  },
};
