import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import selector from "@svet/files-glob";
import { loadConfig, run, validateSelection } from "../../../src/index.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "svet glob \u03bb "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function select(root, pattern, input = null) {
  return validateSelection(
    await selector.select({ root, options: { pattern }, input }),
  );
}

async function configured(root, files, extra = {}) {
  const configFile = join(root, "svet.config.json");
  await writeFile(
    configFile,
    JSON.stringify({
      files,
      checks: [
        {
          plugin: new URL("../../../fixtures/file-check.mjs", import.meta.url)
            .href,
        },
      ],
      ...extra,
    }),
  );
  return run(await loadConfig({ cwd: root, configFile }));
}

test("glob sources capture regular-file snapshots, binaries, directories, Unicode, and explicit dotfiles", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "a.txt"), "bad original\n");
  await writeFile(join(root, "nested", "space \u03bb.txt"), "nested\n");
  await writeFile(join(root, ".hidden.txt"), "hidden\n");
  await writeFile(join(root, "binary.txt"), Buffer.from([0, 1]));
  if (process.platform !== "win32") {
    const outside = await workspace(t);
    await writeFile(join(outside, "outside.txt"), "not inside the source\n");
    await symlink("a.txt", join(root, "link.txt"));
    await symlink(outside, join(root, "directory-link"), "dir");
  }
  const selection = await select(root, "**/*.txt");
  assert.deepEqual(
    selection.candidates.map((item) => item.path),
    ["a.txt", "binary.txt", "nested/space \u03bb.txt"],
  );
  const binary = selection.candidates.find(
    (item) => item.path === "binary.txt",
  );
  assert.equal(
    selection.capabilities["content.text"].isText(await binary.read()),
    false,
  );
  assert.equal(selection.capabilities["git.index"], undefined);
  assert.ok(
    selection.capabilities["fs.inventory"].some(
      (item) => item.path === "nested" && item.metadata.kind === "directory",
    ),
  );
  const first = selection.candidates[0];
  await writeFile(join(root, "a.txt"), "changed\n");
  const bytes = await first.read();
  assert.equal(new TextDecoder().decode(bytes), "bad original\n");
  bytes.fill(0);
  assert.equal(new TextDecoder().decode(await first.read()), "bad original\n");
  if (process.platform !== "win32") {
    assert.equal(
      selection.decisions.find((item) => item.path === "link.txt").state,
      "excluded",
    );
  }
  assert.deepEqual(
    (await select(root, ".*.txt")).candidates.map((item) => item.path),
    [".hidden.txt"],
  );
  assert.ok(
    (await select(root, "**")).candidates.some(
      (item) => item.path === "nested/space \u03bb.txt",
    ),
  );
  assert.equal(
    await readFile(join(root, "nested", "space \u03bb.txt"), "utf8"),
    "nested\n",
  );
});

test("glob filtering preserves object identity, opaque capabilities, inventory, and context without reading disk or snapshots", async () => {
  const read = () => {
    throw new Error("A filter must not read bytes.");
  };
  const candidates = [
    {
      id: "a",
      path: "src/space \u03bb.js",
      read,
      snapshot: { kind: "index", id: "blob-a" },
    },
    { id: "b", path: "vendor/file.js", read },
    { id: "c", path: "src/file.ts", read },
  ];
  const input = {
    candidates,
    capabilities: { "git.index": { read }, "fs.inventory": candidates },
    context: { snapshot: "index" },
    decisions: [
      { path: "prior", state: "excluded", reason: "Source decision." },
    ],
  };
  const js = await select("/a/nonexistent/root", "**/*.js", input);
  const filtered = await select("/a/nonexistent/root", "!vendor/**", js);
  assert.deepEqual(filtered.candidates, [candidates[0]]);
  assert.equal(filtered.candidates[0], candidates[0]);
  assert.equal(filtered.capabilities, input.capabilities);
  assert.equal(filtered.capabilities["fs.inventory"], candidates);
  assert.equal(filtered.context, input.context);
  assert.deepEqual(
    filtered.decisions.map((item) => item.state),
    ["selected", "filtered"],
  );
});

test("glob shortcuts run through the same public selector as explicit plugin entries and retain pipeline provenance", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.js"), "bad original\n");
  await writeFile(join(root, "b.ts"), "bad counterpart\n");
  const shortcut = await configured(root, "*.{js,ts}");
  const explicit = await configured(root, {
    plugin: import.meta.resolve("@svet/files-glob"),
    options: { pattern: "*.{js,ts}" },
  });
  assert.equal(shortcut.exitCode, 1, JSON.stringify(shortcut.errors));
  assert.deepEqual(shortcut.findings, explicit.findings);
  assert.deepEqual(
    shortcut.selection.candidates,
    explicit.selection.candidates,
  );
  assert.equal(shortcut.selection.stages[0].pluginId, "files/glob");
  const pipeline = await configured(root, ["*.{js,ts}", "*.js"]);
  assert.deepEqual(
    pipeline.findings.map((item) => item.path),
    ["a.js"],
  );
  assert.ok(
    pipeline.selection.stages[1].decisions.some(
      (item) => item.path === "b.ts" && item.state === "filtered",
    ),
  );
  assert.equal(
    (await configured(root, ["*.js", "*.ts"])).emptyReason,
    "no-candidates",
  );
});

test("glob errors, empty results, and inactive profiles are explicit and preserve independent checks", async (t) => {
  const root = await workspace(t);
  assert.equal(
    (await configured(root, "*.missing")).emptyReason,
    "no-candidates",
  );
  for (const files of ["[invalid", "../outside/*", "/absolute/*", "!*.txt"]) {
    const report = await configured(root, files);
    assert.equal(report.exitCode, 2);
    assert.equal(report.errors[0].reference, files);
  }
  const inactive = await configured(root, [], {
    profiles: { unused: { files: "/invalid/absolute/*" } },
  });
  assert.equal(inactive.exitCode, 2);
  assert.equal(inactive.errors[0].code, "CAPABILITY_UNAVAILABLE");
  assert.deepEqual(inactive.selection.stages, []);
  const afterFailure = await configured(root, [
    { plugin: "missing-source-plugin" },
    "*.txt",
  ]);
  assert.equal(afterFailure.selection.stages[1].status, "not-run");
  assert.equal(afterFailure.errors.length, 2);
});
