import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("packed driver runs independent timestamp, glob, Git, and indexed LF plugins offline without source-checkout imports", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-vet packaged \u03bb "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packed = join(root, "packed");
  const consumer = join(root, "consumer");
  const project = join(consumer, "project files");
  const configRoot = join(consumer, "configuration");
  for (const directory of [packed, project, configRoot]) {
    await mkdir(directory, { recursive: true });
  }
  assert.ok(
    process.env.npm_execpath,
    "Run package integration through npm test.",
  );
  function npm(args, cwd) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_offline: "true",
        npm_config_cache: join(root, "empty npm cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const driver = fileURLToPath(new URL("../", import.meta.url));
  const fixture = fileURLToPath(
    new URL("../fixtures/timestamp-package/", import.meta.url),
  );
  function pack(cwd) {
    return join(
      packed,
      JSON.parse(
        npm(
          [
            "pack",
            "--ignore-scripts",
            "--json",
            "--silent",
            "--pack-destination",
            packed,
          ],
          cwd,
        ),
      )[0].filename,
    );
  }
  const archives = npm(["ls", "--all", "--omit=dev", "--parseable"], driver)
    .trim()
    .split(/\r?\n/u)
    .map(pack);
  archives.push(pack(fixture));
  await writeFile(
    join(consumer, "package.json"),
    '{"private":true,"type":"module"}',
  );
  npm(
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...archives,
    ],
    consumer,
  );
  const globModule = join(
    consumer,
    "node_modules",
    "@git-vet",
    "files-glob",
    "index.mjs",
  );
  const globSource = await readFile(globModule);
  await writeFile(
    globModule,
    'throw new Error("An unselected glob plugin was imported.");',
  );
  const indexLfModule = join(
    consumer,
    "node_modules",
    "@git-vet",
    "check-index-lf",
    "index.mjs",
  );
  const indexLfSource = await readFile(indexLfModule);
  await writeFile(
    indexLfModule,
    'throw new Error("An unselected indexed LF plugin was imported.");',
  );

  const old = join(project, "old.txt");
  const recent = join(project, "recent \u03bb.txt");
  await writeFile(old, "old bad content");
  await writeFile(recent, "recent bad content");
  await utimes(old, new Date("2000-01-01"), new Date("2000-01-01"));
  await utimes(recent, new Date("2020-01-01"), new Date("2020-01-01"));
  const before = await Promise.all([stat(old), stat(recent)]);
  const configFile = join(configRoot, "git-vet.config.json");
  await writeFile(
    configFile,
    JSON.stringify({
      files: [
        {
          plugin: "git-vet-fixture-timestamps",
          options: { since: Date.parse("2010-01-01") },
        },
      ],
      checks: [
        { plugin: "git-vet-fixture-timestamps/check" },
        { plugin: "git-vet-fixture-timestamps/inventory" },
      ],
    }),
  );
  const runner = join(consumer, "run.mjs");
  await writeFile(
    runner,
    `
    import net from "node:net";
    net.Socket.prototype.connect = function() {throw new Error("Unexpected runtime networking.");};
    globalThis.fetch = () => {throw new Error("Unexpected runtime fetch.");};
    const {loadConfig,run} = await import("git-vet");
    const config = await loadConfig({
      cwd:${JSON.stringify(project)},root:${JSON.stringify(project)},
      configFile:${JSON.stringify(configFile)},
      defaults:{
        directory:${JSON.stringify(configRoot)},
        config:{
          files:[{plugin:"@git-vet/files-git"}],
          checks:[{plugin:"@git-vet/check-index-lf"}]
        }
      }
    });
    process.stdout.write(JSON.stringify(await run(config)));
  `,
  );
  const output = execFileSync(process.execPath, [runner], {
    cwd: consumer,
    encoding: "utf8",
    env: { ...process.env, PATH: "", Path: "", npm_config_offline: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const report = JSON.parse(output);
  assert.equal(report.status, "findings");
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary.selected, 1);
  assert.equal(report.summary.checkedFiles, 1);
  assert.equal(report.checks[1].status, "completed");
  assert.equal(report.findings[0].pluginId, "fixture/word");
  assert.equal(report.findings[0].path, "recent \u03bb.txt");
  assert.equal(report.selection.stages[0].decisions[0].path, "old.txt");
  assert.equal(report.configuration.root, project);
  assert.equal(report.configuration.source.path, configFile);
  assert.equal(report.selection.capabilities.includes("git.index"), false);
  assert.equal(output.includes("recent bad content"), false);
  assert.equal(output.includes("modifiedAt"), false);
  assert.deepEqual((await readdir(project)).sort(), [
    "old.txt",
    "recent \u03bb.txt",
  ]);
  assert.equal(await readFile(old, "utf8"), "old bad content");
  assert.equal(await readFile(recent, "utf8"), "recent bad content");
  assert.deepEqual(
    (await Promise.all([stat(old), stat(recent)])).map(
      (entry) => entry.mtimeMs,
    ),
    before.map((entry) => entry.mtimeMs),
  );
  await writeFile(indexLfModule, indexLfSource);

  await writeFile(globModule, globSource);
  for (const files of [
    "*.txt",
    { plugin: "@git-vet/files-glob", options: { pattern: "*.txt" } },
  ]) {
    await writeFile(
      configFile,
      JSON.stringify({
        files,
        checks: [{ plugin: "git-vet-fixture-timestamps/check" }],
      }),
    );
    const globReport = JSON.parse(
      execFileSync(process.execPath, [runner], {
        cwd: consumer,
        encoding: "utf8",
        env: { ...process.env, PATH: "", Path: "" },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    assert.equal(globReport.exitCode, 1, JSON.stringify(globReport.errors));
    assert.equal(globReport.selection.stages[0].pluginId, "files/glob");
    assert.deepEqual(
      globReport.findings.map((item) => item.path),
      ["old.txt", "recent \u03bb.txt"],
    );
    assert.ok(
      globReport.selection.candidates.every(
        (item) => item.snapshot.kind === "filesystem",
      ),
    );
  }

  const gitProject = join(consumer, "Git files \u03bb");
  await mkdir(gitProject);
  const git = (...args) =>
    execFileSync("git", ["-C", gitProject, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "--initial-branch=main", "--template=");
  git("config", "core.autocrlf", "false");
  await writeFile(join(gitProject, "tracked.txt"), "bad staged\r\n");
  await writeFile(join(gitProject, "binary.dat"), Buffer.from([0, 1, 2]));
  git("add", "--all");
  await writeFile(join(gitProject, "tracked.txt"), "clean unstaged content\n");
  const index = await readFile(join(gitProject, ".git", "index"));
  await writeFile(
    configFile,
    JSON.stringify({
      files: [
        { plugin: "@git-vet/files-git", options: { mode: "staged" } },
        "*.txt",
      ],
      checks: [
        { plugin: "git-vet-fixture-timestamps/check" },
        { plugin: "git-vet-fixture-timestamps/inventory" },
        { plugin: "@git-vet/check-index-lf" },
      ],
    }),
  );
  await writeFile(
    runner,
    `
    import net from "node:net";
    net.Socket.prototype.connect = function() {throw new Error("Unexpected runtime networking.");};
    globalThis.fetch = () => {throw new Error("Unexpected runtime fetch.");};
    const {loadConfig,run} = await import("git-vet");
    const config = await loadConfig({
      cwd:${JSON.stringify(gitProject)},root:${JSON.stringify(gitProject)},
      configFile:${JSON.stringify(configFile)}
    });
    process.stdout.write(JSON.stringify(await run(config)));
  `,
  );
  const gitReport = JSON.parse(
    execFileSync(process.execPath, [runner], {
      cwd: consumer,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(gitReport.exitCode, 1);
  assert.equal(gitReport.findings[0].path, "tracked.txt");
  assert.equal(gitReport.selection.candidates[0].snapshot.kind, "git-index");
  assert.equal(gitReport.checks[1].status, "completed");
  assert.equal(gitReport.checks[2].status, "completed");
  const lfFinding = gitReport.findings.find(
    (finding) => finding.pluginId === "git/index-lf",
  );
  assert.equal(lfFinding.ruleId, "lf");
  assert.equal(lfFinding.path, "tracked.txt");
  assert.deepEqual(lfFinding.location, { line: 1 });
  assert.deepEqual(await readFile(join(gitProject, ".git", "index")), index);
  assert.equal(
    await readFile(join(gitProject, "tracked.txt"), "utf8"),
    "clean unstaged content\n",
  );
});
