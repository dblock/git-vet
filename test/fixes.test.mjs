import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFixer } from "@svet/files-glob/fixes";
import { loadConfig, run } from "../src/index.mjs";

const eol = import.meta.resolve("@svet/check-file-eol");
const trailing = import.meta.resolve("@svet/check-file-trailing-whitespace");
const gitPlugin = import.meta.resolve("@svet/files-git");

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "svet fixes "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function configure(root, checks = [eol, trailing], files = "*.txt") {
  const configFile = join(root, "svet.config.json");
  await writeFile(configFile, JSON.stringify({ files, checks }));
  return loadConfig({ cwd: root, configFile });
}

async function externalCheck(root, body) {
  const filename = join(root, "check.mjs");
  await writeFile(
    filename,
    `export default {
    apiVersion:1,id:"example/fix",kind:"check",scope:"file",
    rules:["example"],fixable:true,async check({candidate,selection,fix}) {
      if (selection.fixer !== undefined) throw new Error("Writer leaked to check.");
      ${body}
    }};`,
  );
  return filename;
}

test("fixes combine all line endings and trailing runs, preserve bytes/modes, and are idempotent", async (t) => {
  const root = await workspace(t);
  const path = join(root, "a.txt");
  const original = Buffer.from([0xff, 32, 9, 13, 10, 98, 32, 13, 99, 9]);
  await writeFile(path, original);
  await chmod(path, 0o755);
  const mode = (await lstat(path)).mode;
  const config = await configure(root);
  const preview = await run(config, { fix: true, dryRun: true });
  assert.equal(preview.exitCode, 1);
  assert.deepEqual(preview.fix.summary, {
    applied: 0,
    proposed: 1,
    unavailable: 0,
    failed: 0,
  });
  assert.deepEqual(await readFile(path), original);
  assert.ok(!JSON.stringify(preview).includes("replacement"));
  const result = await run(config, { fix: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.fix.summary.applied, 1);
  assert.equal(result.summary.findings, 0);
  assert.deepEqual(await readFile(path), Buffer.from([0xff, 10, 98, 10, 99]));
  assert.equal((await lstat(path)).mode, mode);
  const stat = await lstat(path);
  const again = await run(config, { fix: true });
  assert.deepEqual(again.fix.files, []);
  assert.equal((await lstat(path)).mtimeMs, stat.mtimeMs);
  assert.deepEqual((await readdir(root)).sort(), ["a.txt", "svet.config.json"]);
});

test("fixes honor all EOL policies and exact Unicode whitespace replacement lists", async (t) => {
  const root = await workspace(t);
  const path = join(root, "a.txt");
  for (const [ending, bytes] of [
    ["lf", "\n"],
    ["cr", "\r"],
    ["crlf", "\r\n"],
    ["cr-lf", "\r\n"],
  ]) {
    await writeFile(path, "  a\u{1f600}x\r\nb\t\r \u{1f600}x\nc\u{1f600}x");
    const config = await configure(root, [
      { plugin: eol, options: { eol: ending } },
      { plugin: trailing, options: { whitespace: ["x", "\u{1f600}"] } },
    ]);
    assert.equal((await run(config, { fix: true })).exitCode, 0);
    assert.equal(
      await readFile(path, "utf8"),
      `  a${bytes}b\t${bytes} ${bytes}c`,
    );
  }
});

test("checking dry-run neither imports checks nor claims that checks completed", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.txt"), "a\r\n");
  const check = await externalCheck(root, 'throw new Error("Must not run.");');
  await writeFile(check, 'throw new Error("Must not import.");');
  const result = await run(await configure(root, [check, "not-installed"]), {
    dryRun: true,
  });
  assert.equal(result.status, "planned");
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.selected, 1);
  assert.equal(result.summary.checkedInvocations, 0);
  assert.ok(
    result.checks.every(
      (check) => check.status === "not-run" && check.reason === "dry-run",
    ),
  );
  for (const options of [
    null,
    [],
    { plan: true },
    { fix: "true" },
    { dryRun: 1 },
  ]) {
    await assert.rejects(run(await configure(root), options), {
      code: "INVALID_CONFIG",
    });
  }
});

test("indexed snapshots and indexed checks never redirect fixes to working files or the index", async (t) => {
  const root = await workspace(t);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "--quiet", "--template=");
  git("config", "core.autocrlf", "false");
  await writeFile(join(root, "a.txt"), "index\r\n");
  git("add", "a.txt");
  const index = await readFile(join(root, ".git", "index"));
  await writeFile(join(root, "a.txt"), "working\r\n");
  for (const [checks, source] of [
    [[eol], { plugin: gitPlugin, options: { scope: "staged" } }],
    [[import.meta.resolve("@svet/check-git-index-eol")], { plugin: gitPlugin }],
  ]) {
    const result = await run(await configure(root, checks, [source, "*.txt"]), {
      fix: true,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.fix.summary.unavailable, 1);
    assert.equal(result.fix.summary.applied, 0);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "working\r\n");
    assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  }
});

test("duplicate edits are applied once, while overlapping and out-of-bounds fixes fail explicitly", async (t) => {
  const root = await workspace(t);
  const path = join(root, "a.txt");
  const check = await externalCheck(
    root,
    `
    const bytes=await candidate.read();
    return bytes[0]===97
      ? {findings:[{ruleId:"example",message:"Change first byte."}],
         edits:fix?[{start:0,end:1,replacement:new Uint8Array([98])}]:[]}
      : {findings:[]};
  `,
  );
  await writeFile(path, "a");
  const fixed = await run(await configure(root, [check, check]), { fix: true });
  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.fix.files[0].edits, 1);
  assert.equal(await readFile(path, "utf8"), "b");
  for (const [edits, code] of [
    [
      "[{start:0,end:1,replacement:new Uint8Array([98])},{start:0,end:1,replacement:new Uint8Array([99])}]",
      "FIX_CONFLICT",
    ],
    ["[{start:0,end:2,replacement:new Uint8Array([98])}]", "INVALID_FIX"],
  ]) {
    const plugin = join(root, `${code}.mjs`);
    await writeFile(
      plugin,
      `export default {apiVersion:1,id:"example/${code.toLowerCase().replaceAll("_", "-")}",kind:"check",scope:"file",rules:["example"],fixable:true,
      async check(){return {findings:[{ruleId:"example",message:"Invalid fix."}],edits:${edits}}}};`,
    );
    await writeFile(path, "a");
    const result = await run(await configure(root, [plugin]), { fix: true });
    assert.equal(result.exitCode, 2);
    assert.equal(result.errors[0].code, code);
    assert.equal(result.fix.summary.failed, 1);
    assert.equal(await readFile(path, "utf8"), "a");
  }
});

test("failed targets do not prevent independent fixes and initial check failures survive rechecking", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.txt"), "a\r\n");
  await writeFile(join(root, "b.txt"), "b\r\n");
  const check = await externalCheck(
    root,
    `
    if(candidate.path==="a.txt") throw new Error("Cannot check a.txt.");
    return {findings:[]};
  `,
  );
  const result = await run(await configure(root, [eol, check]), { fix: true });
  assert.equal(result.exitCode, 2);
  assert.equal(result.fix.summary.applied, 1);
  assert.equal(result.fix.summary.failed, 1);
  assert.ok(
    result.errors.some((error) => error.message === "Cannot check a.txt."),
  );
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a\r\n");
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "b\n");
});

test("filesystem writers reject stale content, identity changes, symlinks, hard links and permissions without temporary files", async (t) => {
  const root = await workspace(t);
  for (const mutation of [
    "content",
    "identity",
    "symlink",
    "parent-symlink",
    "hardlink",
    ...(process.platform === "win32" ? [] : ["permissions", "special-mode"]),
  ]) {
    const directory = join(root, mutation);
    await mkdir(join(directory, "parent"), { recursive: true });
    const filename = join(directory, "parent", "a.txt");
    await writeFile(filename, "a\r\n");
    const candidate = { path: "parent/a.txt" };
    const original = await readFile(filename);
    const fixer = await createFixer(directory);
    if (mutation === "hardlink")
      await link(filename, join(directory, "other.txt"));
    if (mutation === "permissions") await chmod(filename, 0o444);
    if (mutation === "special-mode") await chmod(filename, 0o4755);
    await fixer.capture(candidate, original);
    if (mutation === "content") await writeFile(filename, "replacement");
    if (mutation === "identity") {
      await rename(filename, join(directory, "old.txt"));
      await writeFile(filename, original);
    }
    if (mutation === "symlink") {
      await rename(filename, join(directory, "old.txt"));
      await symlink(join(directory, "old.txt"), filename, "file");
    }
    if (mutation === "parent-symlink") {
      await rename(join(directory, "parent"), join(directory, "elsewhere"));
      await symlink(
        join(directory, "elsewhere"),
        join(directory, "parent"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    const request = {
      candidate,
      original,
      replacement: Buffer.from("fixed\n"),
    };
    await assert.rejects(fixer.writer.validate(request));
    await assert.rejects(fixer.writer.apply(request));
    assert.equal(
      await readFile(filename, "utf8"),
      mutation === "content" ? "replacement" : "a\r\n",
    );
    assert.ok(
      !(await readdir(join(directory, "parent"))).some((name) =>
        name.startsWith(".svet-"),
      ),
    );
    if (mutation === "permissions") await chmod(filename, 0o644);
  }
});
