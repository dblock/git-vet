import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadConfig, run } from "../src/index.mjs";

const fixture = (name) =>
  new URL(`../fixtures/${name}.mjs`, import.meta.url).href;
const source = { plugin: fixture("memory-selector") };
const file = { plugin: fixture("file-check") };
const project = { plugin: fixture("project-check") };

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "git-vet runner \u03bb "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function configure(root, document, profile) {
  const configFile = join(root, "git-vet.config.json");
  await writeFile(configFile, JSON.stringify(document));
  return loadConfig({ cwd: root, configFile, profile });
}

async function module(root, name, body) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return path;
}

test("async checks retain findings and independent results after a snapshot read fails", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.txt"), "working tree must not be read");
  const config = await configure(root, {
    selectors: [{ ...source, options: { unreadable: ["a.txt"] } }],
    checks: [{ ...file, severity: "error" }, project],
  });
  const result = await run(config);
  assert.equal(result.status, "error");
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.checkedFiles, 1);
  assert.equal(result.summary.checkedInvocations, 2);
  assert.equal(result.summary.failedInvocations, 1);
  assert.equal(result.findings[0].path, "b.txt");
  assert.equal(result.findings[0].severity, "error");
  assert.equal(result.findings[0].pluginId, "fixture/file");
  assert.equal(result.errors[0].path, "a.txt");
  assert.equal(result.errors[0].message, "Snapshot bytes unavailable.");
  assert.equal(result.checks[1].status, "completed");
  assert.deepEqual(result.selection.candidates[0].snapshot, {
    kind: "memory",
    id: "version-1",
  });
  assert.equal(
    await readFile(join(root, "a.txt"), "utf8"),
    "working tree must not be read",
  );
});

test("inactive/default/installed plugins are not imported, including empty profiles", async (t) => {
  const root = await workspace(t);
  const marker = join(root, "unexpected-import");
  const trap = `import {writeFileSync} from "node:fs";
    writeFileSync(${JSON.stringify(marker)}, "loaded");
    throw new Error("An inactive plugin was loaded.");`;
  await module(root, "inactive.mjs", trap);
  await module(
    root,
    "node_modules/installed-trap/package.json",
    JSON.stringify({
      name: "installed-trap",
      type: "module",
      exports: "./index.mjs",
    }),
  );
  await module(root, "node_modules/installed-trap/index.mjs", trap);
  const config = await configure(
    root,
    {
      checks: [{ plugin: "installed-trap" }],
      profiles: {
        active: { selectors: [source], checks: [project] },
        unused: { checks: [{ plugin: "./inactive.mjs" }] },
        empty: {},
      },
    },
    "active",
  );
  const active = await run(config);
  assert.equal(active.status, "completed");
  assert.equal(active.configuration.profile, "active");
  const empty = await run(
    await configure(
      root,
      {
        selectors: [{ plugin: "./inactive.mjs" }],
        checks: [{ plugin: "installed-trap" }],
        profiles: { empty: {} },
      },
      "empty",
    ),
  );
  assert.equal(empty.status, "empty");
  assert.equal(empty.emptyReason, "no-checks");
  assert.deepEqual(empty.selection.stages, []);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("missing and incompatible plugins and invalid async options fail without losing independent checks", async (t) => {
  const root = await workspace(t);
  const incompatible = await module(
    root,
    "bad-version.mjs",
    'export default {apiVersion: 99, kind: "check", id: "fixture/bad"};',
  );
  const invalidValidator = await module(
    root,
    "invalid-validator.mjs",
    `
    export default {apiVersion:1,id:"fixture/validator",kind:"check",scope:"project",
      rules:["example"],async validateOptions(){return false;},
      async check(){throw new Error("Must not execute invalid options.");}};
  `,
  );
  const config = await configure(root, {
    selectors: [source],
    checks: [
      { plugin: "not-installed-git-vet-check" },
      { plugin: incompatible },
      { ...file, options: { invalid: true } },
      { plugin: invalidValidator },
      project,
    ],
  });
  const result = await run(config);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    [
      "PLUGIN_EXECUTION_FAILED",
      "INVALID_CONTRACT",
      "INVALID_PLUGIN_OPTIONS",
      "INVALID_PLUGIN_OPTIONS",
    ],
  );
  assert.equal(result.checks[4].status, "completed");
  assert.equal(
    result.errors[2].message,
    "Invalid options for fixture/file: Invalid fixture options.",
  );
});

test("missing capabilities never invoke a check or implicitly supply Git", async (t) => {
  const root = await workspace(t);
  const marker = join(root, "unexpected-check");
  const plugin = await module(
    root,
    "index-check.mjs",
    `
    import {writeFileSync} from "node:fs";
    export default {apiVersion:1, id:"fixture/index", kind:"check", scope:"file",
      rules:["lf"], requires:["git.index"], async check() {
        writeFileSync(${JSON.stringify(marker)}, "ran"); return {findings:[]};
      }};
  `,
  );
  const result = await run(
    await configure(root, {
      selectors: [source],
      checks: [{ plugin }, project],
    }),
  );
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.checks[0].missing, ["git.index"]);
  assert.equal(result.checks[0].status, "unavailable");
  assert.equal(result.checks[1].status, "completed");
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("ordered filters retain snapshots, full inventory, and earlier provenance", async (t) => {
  const root = await workspace(t);
  const inventoryCheck = await module(
    root,
    "inventory.mjs",
    `
    export default {apiVersion:1,id:"fixture/inventory",kind:"check",scope:"project",
      rules:["inventory"],requires:["fixture.inventory"],async check({selection}) {
        if (selection.candidates.length !== 1 ||
          selection.capabilities["fixture.inventory"].length !== 2 ||
          selection.decisions.length !== 2 ||
          selection.candidates[0] !== selection.capabilities["fixture.inventory"][1]) {
          throw new Error("Lost selection context.");
        }
        return {findings:[{ruleId:"inventory",message:"Inventory retained.",
          paths: selection.capabilities["fixture.inventory"].map(c => c.path)}]};
      }};
  `,
  );
  const result = await run(
    await configure(root, {
      selectors: [
        {
          ...source,
          options: {
            paths: ["old.txt", "new.txt"],
            modifiedAt: {
              "old.txt": 1,
              "new.txt": 100,
            },
          },
        },
        { plugin: fixture("recent-filter"), options: { since: 50 } },
      ],
      checks: [
        { plugin: inventoryCheck },
        { ...file, options: { clean: true } },
      ],
    }),
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.selected, 1);
  assert.equal(result.summary.checkedFiles, 1);
  assert.deepEqual(result.findings[0].paths, ["new.txt", "old.txt"]);
  assert.equal(result.selection.stages[0].decisions[0].state, "excluded");
  assert.equal(result.selection.stages[1].decisions[0].state, "filtered");
});

test("filters cannot change candidate identity, replace capabilities, or discover new sources", async (t) => {
  const root = await workspace(t);
  const filters = [
    "return {...input,candidates:input.candidates.map(c=>({...c}))};",
    "return {...input,capabilities:{}};",
    "return {...input,candidates:[{id:'new',path:'new.txt'}]};",
  ];
  for (const [index, body] of filters.entries()) {
    const plugin = await module(
      root,
      `bad-filter-${index}.mjs`,
      `
      export default {apiVersion:1,id:"fixture/filter",kind:"selector",
        async select({input}) {${body}}};`,
    );
    const result = await run(
      await configure(root, {
        selectors: [source, { plugin }],
        checks: [project],
      }),
    );
    assert.equal(result.errors[0].code, "INCOMPATIBLE_SELECTION");
    assert.equal(result.selection.status, "failed");
    assert.equal(result.checks[0].status, "completed");
  }
});

test("a failed selector stops later stage imports but preserves independent project checks", async (t) => {
  const root = await workspace(t);
  const failure = await module(
    root,
    "failed.mjs",
    `
    export default {apiVersion:1,id:"fixture/failure",kind:"selector",
      async select(){throw new Error("Selection failed.");}};`,
  );
  const result = await run(
    await configure(root, {
      selectors: [{ plugin: failure }, { plugin: "missing-later-stage" }],
      checks: [file, project],
    }),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.selection.stages[1].status, "not-run");
  assert.equal(
    result.errors.some((error) => error.reference === "missing-later-stage"),
    false,
  );
  assert.equal(result.checks[1].status, "completed");
});

test("empty runs, empty selections, skipped checks, and root-only checks stay distinct", async (t) => {
  const root = await workspace(t);
  const empty = await run(await configure(root, {}));
  assert.equal(empty.status, "empty");
  assert.equal(empty.emptyReason, "no-checks");
  assert.equal(empty.selection.status, "not-configured");
  assert.equal(empty.exitCode, 0);

  const noRequirements = await module(
    root,
    "path-only.mjs",
    `
    export default {apiVersion:1,id:"fixture/path",kind:"check",scope:"file",
      rules:["path"],async check(){throw new Error("No candidate exists.");}};
  `,
  );
  const noSelection = await run(
    await configure(root, {
      checks: [{ plugin: noRequirements }],
    }),
  );
  assert.equal(noSelection.emptyReason, "no-selection");
  assert.equal(noSelection.checks[0].status, "not-run");

  const none = await run(
    await configure(root, {
      selectors: [{ ...source, options: { paths: [] } }],
      checks: [file],
    }),
  );
  assert.equal(none.emptyReason, "no-candidates");
  assert.equal(none.checks[0].status, "not-run");

  const skipped = await run(
    await configure(root, {
      selectors: [source],
      checks: [{ ...file, options: { skip: true } }],
    }),
  );
  assert.equal(skipped.emptyReason, "all-skipped");
  assert.equal(skipped.summary.skippedInvocations, 2);
  assert.equal(skipped.summary.checkedFiles, 0);

  const projectOnly = await run(
    await configure(root, {
      checks: [{ ...project, options: { finding: true } }],
    }),
  );
  assert.equal(projectOnly.exitCode, 1);
  assert.equal(projectOnly.selection.status, "not-configured");
  assert.equal(Object.hasOwn(projectOnly.findings[0], "path"), false);
  const projectSkipped = await run(
    await configure(root, {
      checks: [{ ...project, options: { skip: true } }],
    }),
  );
  assert.equal(projectSkipped.emptyReason, "all-skipped");
});

test("invalid results fail per invocation, and duplicate ids from distinct modules are explicit", async (t) => {
  const root = await workspace(t);
  const invalid = await run(
    await configure(root, {
      selectors: [source],
      checks: [{ ...file, options: { invalidResult: true } }, project],
    }),
  );
  assert.equal(invalid.summary.failedInvocations, 2);
  assert.equal(invalid.errors[0].code, "INVALID_CONTRACT");
  assert.equal(invalid.checks[1].status, "completed");
  const duplicate = await module(
    root,
    "duplicate.mjs",
    `
    export default {apiVersion:1,id:"fixture/project",kind:"check",scope:"project",
      rules:["project"],async check(){return {findings:[]};}};`,
  );
  const result = await run(
    await configure(root, {
      checks: [project, { plugin: duplicate }],
    }),
  );
  assert.equal(result.errors[0].code, "DUPLICATE_PLUGIN_ID");
  assert.equal(result.checks[0].status, "completed");
});

test("reports are deterministic JSON data, not options, bytes, readers, or arbitrary plugin fields", async (t) => {
  const root = await workspace(t);
  const config = (paths) => ({
    selectors: [
      { ...source, options: { paths, content: "private source bytes" } },
    ],
    checks: [file],
  });
  const first = await run(await configure(root, config(["b.txt", "a.txt"])));
  const second = await run(await configure(root, config(["a.txt", "b.txt"])));
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.status, "findings");
  assert.equal(first.exitCode, 1);
  const encoded = JSON.stringify(first);
  assert.equal(encoded.includes("private source bytes"), false);
  assert.equal(encoded.includes("modifiedAt"), false);
  assert.equal(encoded.includes("options"), false);
  assert.equal(encoded.includes("\u001b"), false);
  await assert.rejects(run({}), { code: "INVALID_CONFIG" });
});
