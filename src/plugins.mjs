import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "import-meta-resolve";
import { validatePlugin } from "./contracts.mjs";
import { Error, invariant } from "./errors.mjs";

export async function loadPlugin(entry, kind, moduleRoot) {
  const module = /^@[a-z0-9._-]+$/.test(entry.plugin)
    ? entry.plugin.slice(1)
    : entry.plugin;
  const specifier = isAbsolute(module) ? pathToFileURL(module).href : module;
  const url = resolve(
    specifier,
    pathToFileURL(join(moduleRoot, "__svet_resolver__.mjs")).href,
  );
  invariant(
    new URL(url).protocol === "file:",
    "INVALID_PLUGIN_MODULE",
    "Plugins must resolve to local files or installed packages.",
  );
  const plugin = validatePlugin((await import(url)).default, kind);
  try {
    const result = await plugin.validateOptions?.(entry.options);
    invariant(
      result === undefined,
      "INVALID_PLUGIN_OPTIONS",
      "validateOptions must throw on invalid options, not return a value.",
    );
  } catch (error) {
    throw new Error(
      "INVALID_PLUGIN_OPTIONS",
      `Invalid options for ${plugin.id}: ${
        error instanceof globalThis.Error
          ? error.message
          : "Plugin threw a non-Error value."
      }`,
      { cause: error },
    );
  }
  return { plugin, url };
}
