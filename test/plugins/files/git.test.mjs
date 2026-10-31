import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import selector from "svet-files-git";
import globSelector from "svet-files-glob";
import collisionCheck from "svet-check-path-case-collision";
import caseCheck from "svet-check-path-case";
import { loadConfig, run, validateSelection } from "../../../src/index.mjs";

const execute = promisify(execFile);
async function git(root, ...args) {
  return (await execute("git", ["-C", root, ...args], { encoding: "utf8" }))
    .stdout;
}

async function write(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function repository(t) {
  const container = await realpath(
    await mkdtemp(join(tmpdir(), "svet Git \u03bb ")),
  );
  t.after(() => rm(container, { recursive: true, force: true }));
  const root = join(container, "repository");
  const hooks = join(container, "empty-hooks");
  await mkdir(root);
  await mkdir(hooks);
  await git(root, "init", "--initial-branch=main", "--template=");
  for (const [key, value] of Object.entries({
    "user.name": "Svet Test",
    "user.email": "svet@example.invalid",
    "commit.gpgsign": "false",
    "core.autocrlf": "false",
    "core.hooksPath": hooks,
  }))
    await git(root, "config", key, value);
  return root;
}

async function commit(root) {
  await git(root, "add", "--all");
  await git(root, "commit", "--quiet", "-m", "Fixture");
  return (await git(root, "rev-parse", "HEAD")).trim();
}

async function select(root, options = {}) {
  await selector.validateOptions(options);
  return validateSelection(
    await selector.select({ root, options, input: null }),
  );
}

function paths(selection) {
  return selection.candidates.map((candidate) => candidate.path);
}

const decode = (bytes) => new TextDecoder().decode(bytes);

test("precommit checks indexed bytes, preserves deletions and rename targets, and keeps full context read-only", async (t) => {
  const root = await repository(t);
  for (const [path, bytes] of [
    ["partial.txt", "original\n"],
    ["bad.txt", "original\n"],
    ["gone.txt", "deleted\n"],
    ["old/name.txt", "renamed\n"],
    ["stable.txt", "unchanged\n"],
  ])
    await write(root, path, bytes);
  await commit(root);
  await write(root, "partial.txt", "staged clean\n");
  await write(root, "bad.txt", "staged bad\r\n");
  await git(root, "add", "--", "partial.txt", "bad.txt");
  await write(root, "partial.txt", "unstaged bad\r\n");
  await write(root, "bad.txt", "unstaged fix\n");
  await git(root, "rm", "--", "gone.txt");
  await mkdir(join(root, "new"));
  await git(root, "mv", "--", "old/name.txt", "new/name.txt");
  await write(root, "binary.bin", Buffer.from([0, 255]));
  await git(root, "add", "--", "binary.bin");
  await write(root, "untracked.txt", "not staged\r\n");
  await write(
    root,
    "svet.config.json",
    JSON.stringify({
      files: {
        plugin: import.meta.resolve("svet-files-git"),
        options: { scope: "changed", includeUntracked: true },
      },
      checks: [import.meta.resolve("svet-check-file-eol")],
    }),
  );
  const index = await readFile(join(root, ".git", "index"));
  const selection = validateSelection(
    await selector.select({
      root,
      options: { scope: "changed", includeUntracked: true },
      input: null,
      precommit: true,
    }),
  );
  assert.deepEqual(paths(selection), [
    "bad.txt",
    "new/name.txt",
    "partial.txt",
  ]);
  assert.deepEqual(
    selection.targets.map(({ path, status, oldPath }) => ({
      path,
      status,
      ...(oldPath ? { oldPath } : {}),
    })),
    [
      { path: "bad.txt", status: "modified" },
      { path: "binary.bin", status: "added" },
      { path: "gone.txt", status: "deleted" },
      { path: "new/name.txt", status: "renamed", oldPath: "old/name.txt" },
      { path: "partial.txt", status: "modified" },
    ],
  );
  assert.ok(
    selection.capabilities["fs.inventory"].some(
      (record) => record.path === "stable.txt",
    ),
  );
  assert.equal(selection.context.scope, "staged");
  assert.equal(selection.context.snapshot, "index");
  const filtered = validateSelection(
    await globSelector.select({
      root,
      options: { pattern: "old/**" },
      input: selection,
    }),
  );
  assert.deepEqual(paths(filtered), ["new/name.txt"]);
  assert.equal(filtered.targets[0], selection.targets[3]);
  assert.equal(
    filtered.capabilities["fs.inventory"],
    selection.capabilities["fs.inventory"],
  );
  const excluded = validateSelection(
    await globSelector.select({
      root,
      options: { pattern: "!old/**" },
      input: selection,
    }),
  );
  assert.ok(!excluded.targets.some((target) => target.status === "renamed"));
  const deleted = validateSelection(
    await globSelector.select({
      root,
      options: { pattern: "gone.txt" },
      input: selection,
    }),
  );
  assert.deepEqual(paths(deleted), []);
  assert.deepEqual(
    deleted.targets.map((target) => target.path),
    ["gone.txt"],
  );
  const report = await run(await loadConfig({ cwd: root }), {
    precommit: true,
  });
  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.findings.map((finding) => finding.path),
    ["bad.txt"],
  );
  assert.equal(report.summary.selectedTargets, 5);
  assert.equal(report.summary.checkedFiles, 3);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(await readFile(join(root, "bad.txt"), "utf8"), "unstaged fix\n");
  assert.equal(
    await readFile(join(root, "partial.txt"), "utf8"),
    "unstaged bad\r\n",
  );
  for (const [options, fix, code] of [
    [
      { scope: "revision", base: "HEAD", target: "HEAD" },
      false,
      "GIT_PRECOMMIT_UNSUPPORTED",
    ],
    [{}, true, "GIT_PRECOMMIT_READ_ONLY"],
  ])
    await assert.rejects(
      selector.select({ root, options, input: null, precommit: true, fix }),
      { code },
    );
});

test("path checks compare staged additions with unchanged indexed names and allow a resulting case-only rename", async (t) => {
  const root = await repository(t);
  await git(root, "config", "core.ignorecase", "false");
  await write(root, "blob.txt", "snapshot\n");
  const oid = (await git(root, "hash-object", "-w", "--", "blob.txt")).trim();
  await git(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    "100644",
    oid,
    "Foo.txt",
  );
  await git(root, "commit", "--quiet", "-m", "Original indexed name");
  await git(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    "100644",
    oid,
    "foo.txt",
  );
  const index = await readFile(join(root, ".git", "index"));
  const selection = await select(root, { scope: "staged" });
  assert.deepEqual(paths(selection), ["foo.txt"]);
  assert.deepEqual(
    (await collisionCheck.check({ selection })).findings[0].paths,
    ["Foo.txt", "foo.txt"],
  );
  assert.deepEqual(
    (await caseCheck.check({ selection })).findings.map(
      (finding) => finding.path,
    ),
    ["Foo.txt"],
  );
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  await git(root, "update-index", "--force-remove", "--", "Foo.txt");
  const renamed = await select(root, { scope: "staged" });
  assert.deepEqual(
    (await collisionCheck.check({ selection: renamed })).findings,
    [],
  );
});

test("path checks retain binary-only collisions even when no content candidates are selected", async (t) => {
  const root = await repository(t);
  await git(root, "config", "core.ignorecase", "false");
  await write(root, "blob.bin", Buffer.from([0, 255]));
  const oid = (await git(root, "hash-object", "-w", "--", "blob.bin")).trim();
  for (const path of ["Image.png", "image.png"])
    await git(
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      "100644",
      oid,
      path,
    );
  const selection = await select(root, { scope: "staged" });
  assert.deepEqual(paths(selection), []);
  assert.deepEqual(
    (await collisionCheck.check({ selection })).findings[0].paths,
    ["Image.png", "image.png"],
  );
  assert.deepEqual(
    (await caseCheck.check({ selection })).findings.map(
      (finding) => finding.path,
    ),
    ["Image.png"],
  );
});

test("tracked-text defaults retain unchanged/new staged text, binary/directory inventory, and provenance", async (t) => {
  const root = await repository(t);
  for (const [path, content] of [
    [".gitignore", "*.ignore\nignored.tmp\nignored-dir/\n"],
    ["normal.txt", "original\n"],
    ["empty", ""],
    ["extensionless", "hello"],
    ["assets/binary.md", Buffer.from([255, 0, 254])],
    ["stable/counterpart.txt", "stable\n"],
  ])
    await write(root, path, content);
  await commit(root);
  await write(root, "kept.ignore", "tracked despite ignore pattern\n");
  await git(root, "add", "--force", "--", "kept.ignore");
  await write(root, "new \u03bb.txt", "new staged\n");
  await git(root, "add", "--", "new \u03bb.txt");
  await write(root, "untracked.txt", "untracked\n");
  await write(root, "ignored.tmp", "ignored\n");
  await write(root, "ignored-dir/hidden.txt", "ignored descendant\n");
  const index = await readFile(join(root, ".git", "index"));
  const selection = await select(root);
  assert.deepEqual(paths(selection), [
    ".gitignore",
    "empty",
    "extensionless",
    "kept.ignore",
    "new \u03bb.txt",
    "normal.txt",
    "stable/counterpart.txt",
  ]);
  assert.equal(
    selection.candidates.find((file) => file.path === "normal.txt").metadata.git
      .status,
    "unchanged",
  );
  assert.equal(
    selection.candidates.find((file) => file.path === "new \u03bb.txt").metadata
      .git.indexStatus,
    "added",
  );
  const inventory = selection.capabilities["fs.inventory"];
  assert.ok(
    inventory.some(
      (file) =>
        file.path === "assets/binary.md" && file.metadata.text === false,
    ),
  );
  assert.ok(
    inventory.some(
      (file) => file.path === "assets" && file.metadata.kind === "directory",
    ),
  );
  assert.equal(
    selection.decisions.find((item) => item.path === "untracked.txt").state,
    "excluded",
  );
  assert.equal(
    selection.decisions.find((item) => item.path === "ignored-dir/").state,
    "excluded",
  );
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);

  const snapshot = selection.candidates.find(
    (file) => file.path === "normal.txt",
  );
  await write(root, "normal.txt", "replacement\n");
  await git(root, "add", "--", "normal.txt");
  assert.equal(decode(await snapshot.read()), "original\n");
  assert.equal(
    decode(await selection.capabilities["git.index"].read("normal.txt")),
    "original\n",
  );
  assert.deepEqual(
    await selection.capabilities["git.index"].read("assets/binary.md"),
    new Uint8Array([255, 0, 254]),
  );
});

test("untracked/ignored inclusion is explicit and glob exclusions retain full context", async (t) => {
  const root = await repository(t);
  await write(root, ".gitignore", "ignored/**\n");
  await write(root, "vendor/file.txt", "vendor\n");
  await write(root, ".hidden.txt", "hidden\n");
  await write(root, "public.txt", "public\n");
  await commit(root);
  await write(root, "untracked.txt", "new\n");
  await write(root, "ignored/deep/file.txt", "ignored\n");
  const untracked = await select(root, { includeUntracked: true });
  assert.ok(paths(untracked).includes("untracked.txt"));
  assert.equal(paths(untracked).includes("ignored/deep/file.txt"), false);
  const selection = await select(root, {
    includeUntracked: true,
    includeIgnored: true,
    exclude: ["vendor/**", "**/.hidden.txt"],
  });
  assert.deepEqual(paths(selection), [
    ".gitignore",
    "ignored/deep/file.txt",
    "public.txt",
    "untracked.txt",
  ]);
  assert.ok(
    selection.capabilities["fs.inventory"].some(
      (file) => file.path === "vendor/file.txt",
    ),
  );
  assert.equal(
    selection.candidates.find((file) => file.path === "ignored/deep/file.txt")
      .metadata.git.ignored,
    true,
  );
  assert.equal(
    selection.decisions.some(
      (item) => item.state === "excluded" && item.path === "ignored/",
    ),
    false,
  );
  assert.match(
    selection.decisions.find((item) => item.path === "vendor/file.txt").reason,
    /configured exclusion/u,
  );
});

test("staged selection reads captured raw index blobs, not normalized or partially staged worktree bytes", async (t) => {
  const root = await repository(t);
  await write(root, ".gitattributes", "*.txt text eol=lf\n");
  await write(root, "file.txt", "baseline\n");
  await commit(root);
  const blob = join(root, ".git", "raw-fixture-blob");
  await writeFile(blob, "indexed\r\n");
  const oid = (
    await git(root, "hash-object", "-w", "--no-filters", blob)
  ).trim();
  await git(root, "update-index", "--cacheinfo", "100644", oid, "file.txt");
  await write(root, "file.txt", "unstaged and normalized\n");
  const index = await readFile(join(root, ".git", "index"));
  const staged = await select(root, { scope: "staged" });
  assert.deepEqual(paths(staged), ["file.txt"]);
  assert.equal(decode(await staged.candidates[0].read()), "indexed\r\n");
  assert.deepEqual(staged.candidates[0].snapshot, {
    kind: "git-index",
    id: oid,
  });
  assert.equal(staged.candidates[0].metadata.git.indexStatus, "modified");
  assert.equal(staged.candidates[0].metadata.git.worktreeStatus, "modified");
  assert.equal(
    decode(await staged.capabilities["git.index"].read("file.txt")),
    "indexed\r\n",
  );
  const worktree = await select(root);
  assert.equal(
    decode(
      await worktree.candidates.find((file) => file.path === "file.txt").read(),
    ),
    "unstaged and normalized\n",
  );
  const indexed = await select(root, { snapshot: "index" });
  assert.equal(
    decode(
      await indexed.candidates.find((file) => file.path === "file.txt").read(),
    ),
    "indexed\r\n",
  );
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(
    await readFile(join(root, "file.txt"), "utf8"),
    "unstaged and normalized\n",
  );
});

test("staged selection preserves trusted Git environment settings and an alternate index", async (t) => {
  const root = await repository(t);
  await write(root, "file.txt", "baseline\n");
  await commit(root);
  const index = await readFile(join(root, ".git", "index"));
  const alternate = join(root, ".git", "alternate-index");
  await writeFile(alternate, index);
  const globalConfig = join(root, ".git", "caller-config");
  await writeFile(globalConfig, "");
  const environment = {
    ...process.env,
    GIT_INDEX_FILE: alternate,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_EDITOR: "svet-editor-must-not-run",
    GIT_PAGER: "svet-pager-must-not-run",
    GIT_SSH_COMMAND: "svet-ssh-must-not-run",
  };
  await write(root, "file.txt", "alternate staged\n");
  await execute("git", ["-C", root, "add", "--", "file.txt"], {
    env: environment,
  });
  const alternateIndex = await readFile(alternate);
  await write(root, "file.txt", "unstaged\n");
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import selector from ${JSON.stringify(new URL("../../../plugins/files/git/index.mjs", import.meta.url).href)};
    const selection = await selector.select({root:${JSON.stringify(root)},options:{scope:"staged"},input:null});
    process.stdout.write(JSON.stringify({
      paths:selection.candidates.map(file=>file.path),
      content:new TextDecoder().decode(await selection.capabilities["git.index"].read("file.txt"))
    }));
  `,
    ],
    { encoding: "utf8", env: environment },
  );
  assert.deepEqual(JSON.parse(output), {
    paths: ["file.txt"],
    content: "alternate staged\n",
  });
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.deepEqual(await readFile(alternate), alternateIndex);
  assert.equal(await readFile(join(root, "file.txt"), "utf8"), "unstaged\n");
});

test("Git command failures without stderr are not mistaken for success", async (t) => {
  const root = await repository(t);
  const { git: command } = await import("../../../plugins/files/git/git.mjs");
  const args = ["config", "--get", "svet.missing"];
  await assert.rejects(command(root, args), { code: "GIT_COMMAND_FAILED" });
  const result = await command(root, args, [0, 1]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.length, 0);
});

test("changed/staged scopes distinguish renames, deleted paths, unstaged changes, and unchanged counterparts", async (t) => {
  const root = await repository(t);
  for (const path of [
    "old name.txt",
    "remove.txt",
    "modified.txt",
    "stable.txt",
  ]) {
    await write(root, path, `${path}\n`);
  }
  const baseline = await commit(root);
  await git(root, "mv", "--", "old name.txt", "new \u03bb.txt");
  await git(root, "rm", "--", "remove.txt");
  await write(root, "modified.txt", "unstaged\n");
  const changed = await select(root, { scope: "changed" });
  assert.deepEqual(paths(changed), ["modified.txt", "new \u03bb.txt"]);
  assert.equal(changed.context.baseline, baseline);
  const renamed = changed.candidates.find(
    (file) => file.path === "new \u03bb.txt",
  );
  assert.equal(renamed.metadata.git.status, "renamed");
  assert.equal(renamed.metadata.git.oldPath, "old name.txt");
  const staged = await select(root, { scope: "staged" });
  assert.deepEqual(paths(staged), ["new \u03bb.txt"]);
  assert.ok(
    staged.capabilities["fs.inventory"].some(
      (file) => file.path === "stable.txt",
    ),
  );
  assert.equal(
    staged.decisions.find((item) => item.path === "stable.txt").state,
    "filtered",
  );
  assert.equal(
    staged.decisions.find((item) => item.path === "remove.txt").state,
    "unavailable",
  );
  assert.ok(
    staged.capabilities["git.changes"].entries.some(
      (entry) => entry.path === "remove.txt" && entry.status === "deleted",
    ),
  );
});

test("revision comparisons use target blobs/full inventory despite dirty working tree and index", async (t) => {
  const root = await repository(t);
  await write(root, "changed.txt", "base\n");
  await write(root, "stable.txt", "unchanged\n");
  await write(root, "removed.txt", "removed\n");
  await write(root, "old.txt", "rename content\n");
  const base = await commit(root);
  await write(root, "changed.txt", "target\n");
  await git(root, "rm", "--", "removed.txt");
  await git(root, "mv", "--", "old.txt", "renamed.txt");
  const target = await commit(root);
  await write(root, "changed.txt", "new index\n");
  await git(root, "add", "--", "changed.txt");
  await write(root, "changed.txt", "new worktree\n");
  const selection = await select(root, { scope: "revision", base, target });
  assert.deepEqual(paths(selection), ["changed.txt", "renamed.txt"]);
  assert.equal(decode(await selection.candidates[0].read()), "target\n");
  assert.equal(selection.context.target, target);
  assert.equal(selection.context.baseline, base);
  assert.equal(Object.hasOwn(selection.capabilities, "git.index"), false);
  assert.ok(
    selection.capabilities["fs.inventory"].some(
      (file) => file.path === "stable.txt",
    ),
  );
  assert.equal(selection.candidates[1].metadata.git.oldPath, "old.txt");
  assert.equal(
    selection.decisions.find((item) => item.path === "removed.txt").state,
    "unavailable",
  );
  await assert.rejects(
    select(root, { scope: "revision", base: "missing-reference", target }),
    {
      code: "GIT_INVALID_REFERENCE",
    },
  );
});

test("merge-base comparisons are explicit and use only locally available history", async (t) => {
  const root = await repository(t);
  await write(root, "base.txt", "base\n");
  const base = await commit(root);
  await write(root, "main.txt", "main\n");
  const target = await commit(root);
  await git(root, "checkout", "--quiet", "-b", "other", base);
  await write(root, "other.txt", "other\n");
  await commit(root);
  const selection = await select(root, {
    scope: "revision",
    base: "other",
    target,
    mergeBase: true,
  });
  assert.equal(selection.context.baseline, base);
  assert.deepEqual(paths(selection), ["main.txt"]);
  await git(root, "checkout", "--quiet", "--orphan", "unrelated");
  await git(root, "rm", "-r", "--cached", ".");
  await write(root, "unrelated.txt", "unrelated\n");
  await commit(root);
  await assert.rejects(
    select(root, {
      scope: "revision",
      base: "unrelated",
      target,
      mergeBase: true,
    }),
    {
      code: "GIT_BASELINE_UNAVAILABLE",
    },
  );
});

test("unborn repositories, linked worktrees, subdirectories, and shallow history are supported", async (t) => {
  const root = await repository(t);
  await write(root, "nested/new.txt", "new\n");
  await git(root, "add", "--all");
  const unborn = await select(root, { scope: "staged" });
  assert.equal(unborn.context.baseline, null);
  assert.deepEqual(paths(unborn), ["nested/new.txt"]);
  await commit(root);
  const nested = await select(join(root, "nested"));
  assert.equal(resolve(nested.context.repositoryRoot), root);
  assert.deepEqual(paths(nested), ["nested/new.txt"]);
  const linked = join(dirname(root), "linked worktree \u03bb");
  await git(root, "worktree", "add", "--quiet", "--detach", linked, "HEAD");
  assert.deepEqual(paths(await select(linked)), ["nested/new.txt"]);
  await write(root, "second.txt", "second\n");
  await commit(root);
  const shallow = join(dirname(root), "shallow clone");
  await git(
    root,
    "clone",
    "--quiet",
    "--depth=1",
    "--no-local",
    pathToFileURL(root).href,
    shallow,
  );
  assert.ok(paths(await select(shallow)).includes("second.txt"));
  await assert.rejects(
    select(shallow, { scope: "revision", base: "HEAD~1", target: "HEAD" }),
    {
      code: "GIT_INVALID_REFERENCE",
    },
  );
});

test("case-only renames and unusual representable names retain exact paths", async (t) => {
  const root = await repository(t);
  const names = [
    " leading and trailing .txt",
    "\u03bb \u6587.txt",
    ...(process.platform === "win32" ? [] : ["tab\tline\nback\\slash.txt"]),
  ];
  await write(root, "Mixed.txt", "case-only rename\n");
  for (const name of names) await write(root, name, "text\n");
  await commit(root);
  await git(root, "mv", "--force", "--", "Mixed.txt", "mixed.txt");
  const staged = await select(root, { scope: "staged" });
  assert.deepEqual(paths(staged), ["mixed.txt"]);
  assert.equal(staged.candidates[0].metadata.git.oldPath, "Mixed.txt");
  assert.equal(
    staged.capabilities["fs.inventory"].some(
      (file) => file.path === "Mixed.txt",
    ),
    false,
  );
  const all = await select(root);
  for (const name of names) assert.ok(paths(all).includes(name));
});

test("missing worktree files, symlinks, and unmerged index entries never masquerade as checked content", async (t) => {
  const root = await repository(t);
  await write(root, "missing.txt", "missing\n");
  await write(root, "ordinary.txt", "ordinary\n");
  await commit(root);
  await rm(join(root, "missing.txt"));
  if (process.platform !== "win32") {
    const outside = join(dirname(root), "outside.txt");
    await writeFile(outside, "outside source must not be read");
    await symlink(outside, join(root, "link.txt"));
    await git(root, "add", "--", "link.txt");
    await rm(join(root, "ordinary.txt"));
    await symlink(outside, join(root, "ordinary.txt"));
  }
  const selection = await select(root);
  assert.equal(paths(selection).includes("missing.txt"), false);
  assert.equal(
    selection.decisions.find((item) => item.path === "missing.txt").state,
    "unavailable",
  );
  if (process.platform !== "win32") {
    assert.equal(paths(selection).includes("link.txt"), false);
    assert.equal(paths(selection).includes("ordinary.txt"), false);
  }
  const oid = (await git(root, "rev-parse", "HEAD:ordinary.txt")).trim();
  const input = `0 ${"0".repeat(oid.length)}\tordinary.txt\n100644 ${oid} 1\tordinary.txt\n100644 ${oid} 2\tordinary.txt\n100644 ${oid} 3\tordinary.txt\n`;
  await new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", root, "update-index", "--index-info"],
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin.end(input);
  });
  await assert.rejects(select(root), { code: "GIT_UNMERGED_INDEX" });
});

test("missing Git, invalid options, incompatible input, and outside-repository invocation are explicit", async (t) => {
  const root = await repository(t);
  for (const options of [
    { scope: "unknown" },
    { scope: null },
    { snapshot: null },
    { scope: "staged", snapshot: "worktree" },
    { scope: "revision", base: "HEAD" },
    { base: "main" },
    { includeIgnored: true },
    { includeUntracked: "yes" },
    { snapshot: "index", includeUntracked: true },
    { exclude: [false] },
    { typo: true },
  ])
    assert.throws(() => selector.validateOptions(options));
  await assert.rejects(
    selector.select({ root, options: {}, input: { candidates: [] } }),
    {
      code: "GIT_SOURCE_ONLY",
    },
  );
  const outside = dirname(root);
  await assert.rejects(select(outside), { code: "GIT_NOT_REPOSITORY" });
  const configFile = join(outside, "svet.config.json");
  await writeFile(
    configFile,
    JSON.stringify({
      files: [
        {
          plugin: new URL(
            "../../../plugins/files/git/index.mjs",
            import.meta.url,
          ).href,
        },
      ],
    }),
  );
  const report = await run(await loadConfig({ cwd: outside, configFile }));
  assert.equal(report.errors[0].pluginCode, "GIT_NOT_REPOSITORY");
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import selector from ${JSON.stringify(new URL("../../../plugins/files/git/index.mjs", import.meta.url).href)};
    try {await selector.select({root:${JSON.stringify(root)},options:{},input:null});}
    catch(error) {process.stdout.write(JSON.stringify({code:error.code}));}
  `,
    ],
    { encoding: "utf8", env: { ...process.env, PATH: "", Path: "" } },
  );
  assert.equal(JSON.parse(output).code, "GIT_NOT_FOUND");
});

test("selection does not invoke configured fsmonitor or content-filter processes", async (t) => {
  const root = await repository(t);
  await write(root, ".gitattributes", "*.txt filter=trap\n");
  await write(root, "file.txt", "baseline\n");
  await commit(root);
  const marker = join(root, ".git", "unexpected-process");
  const script = join(root, ".git", "process-trap.cjs");
  await writeFile(
    script,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)},"ran");process.exit(1);`,
  );
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
  await git(root, "config", "filter.trap.process", command);
  await git(root, "config", "filter.trap.required", "true");
  await git(root, "config", "core.fsmonitor", command);
  await write(root, "file.txt", "modified\n");
  await utimes(
    join(root, "file.txt"),
    new Date("2020-01-01"),
    new Date("2020-01-01"),
  );
  const index = await readFile(join(root, ".git", "index"));
  assert.ok(
    paths(await select(root, { scope: "changed" })).includes("file.txt"),
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
});

test("scoped Git shorthand composes with glob shortcuts while retaining full inventory and Git snapshots", async (t) => {
  const root = await repository(t);
  await write(root, "selected.txt", "selected\n");
  await write(root, "counterpart.js", "counterpart\n");
  await git(root, "add", "--all");
  const config = await loadConfig({
    cwd: root,
    root,
    defaults: {
      directory: fileURLToPath(new URL("../../../", import.meta.url)),
      config: {
        files: ["@svet-files-git", "*.txt"],
        checks: [
          new URL(
            "../../../fixtures/timestamp-package/inventory.mjs",
            import.meta.url,
          ).href,
        ],
      },
    },
  });
  const report = await run(config);
  assert.equal(report.exitCode, 0, JSON.stringify(report.errors));
  assert.equal(report.checks[0].status, "completed");
  assert.deepEqual(
    report.selection.stages.map((stage) => stage.pluginId),
    ["git/tracked-text", "files/glob"],
  );
  assert.deepEqual(
    report.selection.candidates.map((candidate) => candidate.path),
    ["selected.txt"],
  );
  assert.deepEqual(
    report.selection.candidates[0].snapshot,
    report.selection.stages[0].candidates.find(
      (candidate) => candidate.path === "selected.txt",
    ).snapshot,
  );
  assert.ok(report.selection.capabilities.includes("git.index"));
});
