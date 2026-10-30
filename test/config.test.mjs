import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Error, loadConfig, resolveConfig } from "../src/index.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "svet config \u03bb "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("custom and empty configurations replace every supplied default", async (t) => {
  const cwd = await workspace(t);
  const configFile = join(cwd, "custom.json");
  const defaults = {
    directory: cwd,
    config: {
      files: [{ plugin: "uninstalled-default-selector" }],
      checks: [{ plugin: "uninstalled-default-check" }],
      profiles: { inherited: { checks: [{ plugin: "uninstalled-profile" }] } },
    },
  };
  const shipped = await loadConfig({ cwd, defaults });
  assert.equal(shipped.source.kind, "defaults");
  assert.equal(shipped.files[0].plugin, "uninstalled-default-selector");

  await writeFile(configFile, '{"checks":[{"plugin":"custom-check"}]}');
  const custom = await loadConfig({ cwd, defaults, configFile });
  assert.deepEqual(custom.files, []);
  assert.deepEqual(custom.checks, [{ plugin: "custom-check", options: {} }]);
  assert.equal(custom.source.kind, "file");
  await assert.rejects(
    loadConfig({ cwd, defaults, configFile, profile: "inherited" }),
    { code: "INVALID_CONFIG" },
  );

  await writeFile(configFile, "{}");
  const empty = await loadConfig({ cwd, defaults, configFile });
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.checks, []);
});

test("profiles replace the complete base plan, including intentionally empty profiles", () => {
  const config = {
    files: [{ plugin: "base-selector" }],
    checks: [{ plugin: "base-check" }],
    profiles: {
      independent: { checks: [{ plugin: "profile-check" }] },
      empty: {},
    },
  };
  assert.deepEqual(resolveConfig(config, { profile: "independent" }), {
    profile: "independent",
    files: [],
    checks: [{ plugin: "profile-check", options: {} }],
  });
  assert.deepEqual(resolveConfig(config, { profile: "empty" }), {
    profile: "empty",
    files: [],
    checks: [],
  });
  for (const profile of ["missing", "constructor", "", null]) {
    assert.throws(() => resolveConfig(config, { profile }), {
      code: "INVALID_CONFIG",
    });
  }
});

test("files accepts scoped plugin and glob shortcuts, single objects, and ordered mixed pipelines", () => {
  const git = { plugin: "@svet/files-git", options: {} };
  assert.deepEqual(resolveConfig({ files: "@svet/files-git" }).files, [git]);
  assert.deepEqual(resolveConfig({ files: "**/*.js" }).files, ["**/*.js"]);
  const object = { plugin: "./source.mjs", options: { recent: true } };
  assert.deepEqual(resolveConfig({ files: object }).files, [object]);
  const plan = resolveConfig({
    files: ["@svet/files-git", "**/*.{js,ts}", "!vendor/**", object],
    profiles: { js: { files: "**/*.js" }, empty: {} },
  });
  assert.deepEqual(plan.files, [git, "**/*.{js,ts}", "!vendor/**", object]);
  assert.deepEqual(
    resolveConfig({ files: plan.files, checks: plan.checks }),
    plan,
  );
  assert.deepEqual(
    resolveConfig(
      { files: "@svet/files-git", profiles: { js: { files: "*.js" } } },
      { profile: "js" },
    ).files,
    ["*.js"],
  );
  assert.deepEqual(
    resolveConfig(
      { files: "@svet/files-git", profiles: { empty: {} } },
      { profile: "empty" },
    ).files,
    [],
  );
});

test("discovery finds the nearest config without consulting Git and resolves modules beside it", async (t) => {
  const root = await workspace(t);
  const nested = join(root, "nested", "deeper");
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, "svet.config.mjs"), "export default {};");
  const config = await loadConfig({ cwd: nested });
  assert.equal(config.root, root);
  assert.equal(config.moduleRoot, root);
  assert.equal(config.source.path, join(root, "svet.config.mjs"));

  const nearer = join(root, "nested", "svet.config.json");
  await writeFile(nearer, '{"checks":[{"plugin":"./check.mjs"}]}');
  const local = await loadConfig({ cwd: nested });
  assert.equal(local.root, join(root, "nested"));
  assert.equal(local.source.path, nearer);
});

test("an explicit root bounds discovery while an explicit file is relative to cwd", async (t) => {
  const cwd = await workspace(t);
  const root = join(cwd, "project");
  await mkdir(root);
  await writeFile(join(cwd, "svet.config.json"), "{}");
  await assert.rejects(loadConfig({ cwd, root: "project" }), {
    code: "DEFAULT_CONFIG_UNAVAILABLE",
  });
  const config = await loadConfig({
    cwd,
    root: "project",
    configFile: "svet.config.json",
  });
  assert.equal(config.root, root);
  assert.equal(config.moduleRoot, cwd);
});

test("missing, malformed, ambiguous, and invalid configurations fail explicitly", async (t) => {
  const cwd = await workspace(t);
  const json = join(cwd, "svet.config.json");
  const mjs = join(cwd, "svet.config.mjs");
  await assert.rejects(
    loadConfig({ cwd, configFile: "missing.json", defaults: { config: {} } }),
    { code: "CONFIG_LOAD_FAILED" },
  );
  await writeFile(json, "{");
  await assert.rejects(loadConfig({ cwd }), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, "CONFIG_LOAD_FAILED");
    assert.ok(error.cause instanceof globalThis.Error);
    assert.equal(error.cause instanceof Error, false);
    return true;
  });
  await writeFile(mjs, "export default {};");
  await assert.rejects(loadConfig({ cwd }), { code: "AMBIGUOUS_CONFIG" });
  await rm(json);
  await writeFile(mjs, "export const config = {};");
  await assert.rejects(loadConfig({ cwd }), { code: "INVALID_CONFIG" });
  await assert.rejects(loadConfig({ cwd, root: "missing" }), {
    code: "INVALID_ROOT",
  });
});

test("a broken configuration symlink is an error, not absent configuration", async (t) => {
  if (process.platform === "win32") {
    t.skip("Creating file symlinks requires Windows developer privileges.");
    return;
  }
  const cwd = await workspace(t);
  await symlink("missing.mjs", join(cwd, "svet.config.mjs"));
  await assert.rejects(loadConfig({ cwd }), { code: "CONFIG_LOAD_FAILED" });
});

test("strict configuration shapes reject accidental inheritance and malformed entries", () => {
  for (const config of [
    null,
    [],
    new Map(),
    { extends: "defaults" },
    { selectors: [] },
    { files: null },
    { files: "" },
    { files: ["   "] },
    { files: [42] },
    { files: [["*.js"]] },
    { files: { glob: "*.js" } },
    { checks: ["a-package"] },
    { checks: [{ plugin: "" }] },
    { checks: [{ plugin: "check", options: [] }] },
    { checks: [{ plugin: "check", severity: "off" }] },
    { files: [{ plugin: "select", severity: "error" }] },
    { profiles: null },
    { profiles: { nested: { profiles: {} } } },
  ]) {
    assert.throws(() => resolveConfig(config), { code: "INVALID_CONFIG" });
  }
});
