import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Error, invariant } from "./errors.mjs";
import { isRecord } from "./contracts.mjs";

const filenames = ["git-vet.config.mjs", "git-vet.config.json"];

function assert(condition, message) {
  invariant(condition, "INVALID_CONFIG", message);
}

function keys(object, allowed, label) {
  assert(isRecord(object), `${label} must be an object.`);
  for (const key of Object.keys(object)) {
    assert(allowed.includes(key), `Unknown ${label} field: ${key}.`);
  }
}

function entries(value, kind) {
  if (value === undefined) {
    return [];
  }
  assert(Array.isArray(value), `${kind} must be an array.`);
  return value.map((entry) => {
    keys(
      entry,
      kind === "checks"
        ? ["plugin", "options", "severity"]
        : ["plugin", "options"],
      `${kind} entry`,
    );
    assert(
      typeof entry.plugin === "string" && entry.plugin.trim().length > 0,
      `Each ${kind} entry must name a plugin module.`,
    );
    assert(
      entry.options === undefined || isRecord(entry.options),
      `Plugin ${entry.plugin} options must be an object.`,
    );
    assert(
      entry.severity === undefined ||
        ["error", "warning"].includes(entry.severity),
      `Plugin ${entry.plugin} severity must be error or warning.`,
    );
    return {
      plugin: entry.plugin,
      options: { ...entry.options },
      ...(entry.severity === undefined ? {} : { severity: entry.severity }),
    };
  });
}

export function resolveConfig(document, { profile } = {}) {
  keys(document, ["selectors", "checks", "profiles"], "configuration");
  const base = {
    selectors: entries(document.selectors, "selectors"),
    checks: entries(document.checks, "checks"),
  };
  const profiles = document.profiles === undefined ? {} : document.profiles;
  assert(isRecord(profiles), "Profiles must be an object.");
  const plans = new Map();
  for (const [name, plan] of Object.entries(profiles)) {
    assert(name.length > 0, "Profile names must not be empty.");
    keys(plan, ["selectors", "checks"], `profile ${name}`);
    plans.set(name, {
      selectors: entries(plan.selectors, "selectors"),
      checks: entries(plan.checks, "checks"),
    });
  }
  if (profile === undefined) {
    return { ...base, profile: null };
  }
  assert(
    typeof profile === "string" && plans.has(profile),
    `Unknown profile: ${String(profile)}.`,
  );
  return { ...plans.get(profile), profile };
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw new Error("CONFIG_DISCOVERY_FAILED", `Cannot inspect ${path}.`, {
      cause: error,
    });
  }
}

async function directory(path) {
  try {
    invariant(
      (await stat(path)).isDirectory(),
      "INVALID_ROOT",
      `Not a directory: ${path}.`,
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("INVALID_ROOT", `Cannot access directory ${path}.`, {
      cause: error,
    });
  }
}

async function discover(start, ancestors) {
  let current = start;
  for (;;) {
    const matches = [];
    for (const filename of filenames) {
      const path = join(current, filename);
      if (await exists(path)) {
        matches.push(path);
      }
    }
    invariant(
      matches.length <= 1,
      "AMBIGUOUS_CONFIG",
      `Both supported configuration files exist in ${current}.`,
    );
    if (matches.length) {
      return matches[0];
    }
    const parent = dirname(current);
    if (!ancestors || parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function readConfig(path) {
  try {
    if (path.endsWith(".json")) {
      return JSON.parse(await readFile(path, "utf8"));
    }
    invariant(
      path.endsWith(".mjs"),
      "INVALID_CONFIG",
      "Configuration files must use .mjs or .json.",
    );
    return (await import(pathToFileURL(path).href)).default;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("CONFIG_LOAD_FAILED", `Cannot load ${path}.`, {
      cause: error,
    });
  }
}

export async function loadConfig({
  cwd = process.cwd(),
  root,
  configFile,
  profile,
  defaults,
} = {}) {
  assert(typeof cwd === "string" && cwd.length > 0, "cwd must be a directory.");
  assert(
    root === undefined || (typeof root === "string" && root.length > 0),
    "root must be a directory.",
  );
  assert(
    configFile === undefined ||
      (typeof configFile === "string" && configFile.length > 0),
    "configFile must name a file.",
  );
  cwd = resolve(cwd);
  const explicitRoot = root === undefined ? undefined : resolve(cwd, root);
  await directory(cwd);
  if (explicitRoot !== undefined) {
    await directory(explicitRoot);
  }
  const path =
    configFile === undefined
      ? await discover(explicitRoot ?? cwd, explicitRoot === undefined)
      : resolve(cwd, configFile);
  if (path !== undefined) {
    const document = await readConfig(path);
    return {
      ...resolveConfig(document, { profile }),
      source: { kind: "file", path },
      root: explicitRoot ?? dirname(path),
      moduleRoot: dirname(path),
    };
  }
  invariant(
    isRecord(defaults) &&
      Object.hasOwn(defaults, "config") &&
      typeof defaults.directory === "string" &&
      defaults.directory.length > 0,
    "DEFAULT_CONFIG_UNAVAILABLE",
    "Shipped defaults are not implemented yet; supply a configuration file or an explicit defaults document.",
  );
  return {
    ...resolveConfig(defaults.config, { profile }),
    source: { kind: "defaults" },
    root: explicitRoot ?? cwd,
    moduleRoot: resolve(cwd, defaults.directory),
  };
}
