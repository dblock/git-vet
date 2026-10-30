import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import check from "@svet/check-git-index-eol";
import selector from "@svet/files-git";
import { loadConfig, run } from "../../../src/index.mjs";

const execute = promisify(execFile);
const moduleRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function git(root, ...args) {
  return (await execute("git", ["-C", root, ...args], { encoding: "utf8" }))
    .stdout;
}

async function repository(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "svet indexed LF \u03bb ")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "--initial-branch=main", "--template=");
  await mkdir(join(root, ".git", "empty-hooks"));
  for (const [key, value] of Object.entries({
    "user.name": "Svet Test",
    "user.email": "svet@example.invalid",
    "commit.gpgsign": "false",
    "core.autocrlf": "false",
    "core.hooksPath": join(root, ".git", "empty-hooks"),
  })) {
    await git(root, "config", key, value);
  }
  return root;
}

async function inspect(root, options = {}) {
  return run(
    await loadConfig({
      cwd: root,
      root,
      defaults: {
        directory: moduleRoot,
        config: {
          files: [{ plugin: "@svet/files-git", options }],
          checks: ["@svet/check-git-index-eol"],
        },
      },
    }),
  );
}

test("indexed EOL checks raw staged bytes, not text replacements, without changing files or index", async (t) => {
  const root = await repository(t);
  const indexed = new Map([
    ["mixed \u03bb no extension", "first\nsecond\r\nthird\n"],
    ["crlf.txt", "first\r\nsecond\r\n"],
    ["lone-cr.txt", "first\rsecond"],
    ["lf.txt", "first\nsecond\n"],
    ["empty", ""],
    ["no-ending", "text without an ending"],
    ["binary.txt", Buffer.from([0, 13, 10])],
  ]);
  for (const [path, content] of indexed) {
    await writeFile(join(root, path), content);
  }
  await git(root, "add", "--all");
  await writeFile(join(root, "mixed \u03bb no extension"), "first\nclean\n");
  await writeFile(join(root, "crlf.txt"), "clean\n");
  await writeFile(join(root, "lf.txt"), "unstaged\r\n");
  await writeFile(join(root, "binary.txt"), "text replacement\r\n");
  await writeFile(join(root, "untracked.txt"), "untracked\r\n");
  const paths = [...indexed.keys(), "untracked.txt"];
  const before = await Promise.all(
    paths.map((path) => readFile(join(root, path))),
  );
  const index = await readFile(join(root, ".git", "index"));

  const report = await inspect(root, { includeUntracked: true });
  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.findings.map(({ pluginId, ruleId, path, location }) => ({
      pluginId,
      ruleId,
      path,
      location,
    })),
    [
      {
        pluginId: "git/index-eol",
        ruleId: "eol",
        path: "lone-cr.txt",
        location: { line: 1 },
      },
      {
        pluginId: "git/index-eol",
        ruleId: "eol",
        path: "crlf.txt",
        location: { line: 1 },
      },
      {
        pluginId: "git/index-eol",
        ruleId: "eol",
        path: "mixed \u03bb no extension",
        location: { line: 2 },
      },
    ],
  );
  const outcomes = report.checks[0].outcomes;
  assert.match(
    outcomes.find((item) => item.path === "binary.txt").reason,
    /binary/,
  );
  assert.match(
    outcomes.find((item) => item.path === "untracked.txt").reason,
    /no captured Git index/,
  );
  assert.equal(JSON.stringify(report).includes("text replacement"), false);
  assert.match(
    report.findings[0].message,
    /stage the intended changes manually/,
  );
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(join(root, path)))),
    before,
  );
});

test("staged scope and provider exclusions narrow indexed EOL checks without an extension list", async (t) => {
  const root = await repository(t);
  await mkdir(join(root, "vendor"));
  await writeFile(join(root, "unchanged"), "existing\r\n");
  await writeFile(join(root, "unstaged.txt"), "original\n");
  await git(root, "add", "--all");
  await git(root, "commit", "--quiet", "-m", "Fixture");
  await writeFile(join(root, "new \u03bb"), "new\r\n");
  await writeFile(join(root, "vendor", "excluded"), "excluded\r\n");
  await git(root, "add", "--all");
  await writeFile(join(root, "unstaged.txt"), "not staged\r\n");
  const staged = await inspect(root, {
    mode: "staged",
    exclude: ["vendor/**"],
  });
  assert.deepEqual(
    staged.findings.map((item) => item.path),
    ["new \u03bb"],
  );
  assert.deepEqual(
    staged.selection.candidates.map((item) => item.path),
    ["new \u03bb"],
  );
  const tracked = await inspect(root, {
    snapshot: "index",
    exclude: ["vendor/**"],
  });
  assert.deepEqual(
    tracked.findings.map((item) => item.path),
    ["new \u03bb", "unchanged"],
  );
});

test("checkout normalization does not invalidate LF index blobs and captured index reads survive restaging", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "normalized.txt"), "first\nsecond\n");
  await git(root, "add", "--all");
  await git(root, "config", "core.autocrlf", "true");
  await rm(join(root, "normalized.txt"));
  await git(root, "checkout-index", "--force", "--all");
  assert.equal(
    await readFile(join(root, "normalized.txt"), "utf8"),
    "first\r\nsecond\r\n",
  );
  assert.equal((await inspect(root)).status, "completed");

  await git(root, "config", "core.autocrlf", "false");
  await writeFile(join(root, "normalized.txt"), "first\nbad\r\n");
  await git(root, "add", "--all");
  await writeFile(join(root, "normalized.txt"), "clean replacement\n");
  const selection = await selector.select({ root, options: {}, input: null });
  await git(root, "add", "--all");
  const result = await check.check({
    selection,
    candidate: selection.candidates[0],
  });
  assert.equal(result.findings[0].location.line, 2);
  assert.equal((await inspect(root)).status, "completed");
});

test("missing and revision-only index capabilities are unavailable rather than fallback checks", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "file.txt"), "text\n");
  await git(root, "add", "--all");
  await git(root, "commit", "--quiet", "-m", "Fixture");
  const revision = await inspect(root, {
    mode: "revision",
    base: "HEAD",
    target: "HEAD",
  });
  assert.equal(revision.exitCode, 2);
  assert.equal(revision.checks[0].status, "unavailable");
  assert.deepEqual(revision.checks[0].missing, ["git.index"]);

  const missing = await run(
    await loadConfig({
      cwd: root,
      root,
      defaults: {
        directory: moduleRoot,
        config: { checks: ["@svet/check-git-index-eol"] },
      },
    }),
  );
  assert.equal(missing.exitCode, 2);
  assert.deepEqual(missing.checks[0].missing, ["content.text", "git.index"]);
});

test("indexed EOL reports invalid providers and read failures instead of succeeding or reading candidates", async () => {
  const candidate = {
    path: "file.txt",
    read() {
      throw new Error("Must not read candidate snapshots.");
    },
  };
  const capabilities = {
    "git.index": {
      entries: [{ path: candidate.path, mode: "100644", stage: 0 }],
      async read() {
        throw new Error("Captured blob unavailable.");
      },
    },
    "content.text": { isText: () => true },
  };
  const invoke = () => check.check({ candidate, selection: { capabilities } });
  await assert.rejects(invoke, /Captured blob unavailable/);
  capabilities["git.index"].read = async () => "not bytes";
  await assert.rejects(invoke, /Uint8Array/);
  capabilities["git.index"].read = async () => new Uint8Array();
  capabilities["content.text"].isText = () => undefined;
  await assert.rejects(invoke, /boolean/);
  capabilities["content.text"] = {};
  await assert.rejects(invoke, /requires git.index/);
  capabilities["content.text"].isText = () => true;
  capabilities["git.index"].entries[0].stage = 2;
  await assert.rejects(invoke, /unmerged/);
  capabilities["git.index"].entries[0].stage = 0;
  capabilities["git.index"].entries[0].mode = "120000";
  assert.match((await invoke()).skip, /not a regular/);
  assert.throws(
    () => check.validateOptions({ fix: true }),
    /Unknown indexed EOL check option/,
  );
});
