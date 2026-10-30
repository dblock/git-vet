import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function snapshot(root, prefix = "") {
  const result = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(root, path);
    const { mode, mtimeMs } = await lstat(absolute);
    if (entry.isDirectory()) {
      result[path] = { mode, mtimeMs, directory: await snapshot(root, path) };
    } else if (entry.isFile()) {
      result[path] = { mode, mtimeMs, bytes: await readFile(absolute) };
    } else if (entry.isSymbolicLink()) {
      result[path] = { mode, mtimeMs, target: await readlink(absolute) };
    } else {
      throw new Error(`Unsupported integration fixture entry: ${path}`);
    }
  }
  return result;
}

export async function createConsumer(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "git-vet integration \u03bb ")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const packed = join(root, "packed");
  const consumer = join(root, "consumer");
  await mkdir(packed);
  await mkdir(consumer);
  assert.ok(
    process.env.npm_execpath,
    "Run integration tests through npm test.",
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
  function pack(cwd) {
    const [archive] = JSON.parse(
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
    );
    return join(packed, archive.filename);
  }
  const driver = fileURLToPath(new URL("../", import.meta.url));
  const archives = npm(["ls", "--all", "--omit=dev", "--parseable"], driver)
    .trim()
    .split(/\r?\n/u)
    .map(pack);
  archives.push(
    pack(fileURLToPath(new URL("./timestamp-package/", import.meta.url))),
  );
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
  const executable = join(consumer, "node_modules", ".bin", "git-vet");
  await access(executable);
  const packageRoot = join(consumer, "node_modules", "git-vet");
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const entry = join(packageRoot, manifest.bin["git-vet"]);
  const offline = join(consumer, "offline.mjs");
  await cp(new URL("offline.mjs", import.meta.url), offline);
  const gitConfig = join(root, "empty-git-config");
  await writeFile(gitConfig, "");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  });

  return {
    async run(t, fixture, definition) {
      const directory = await mkdtemp(join(consumer, "scenario \u03bb "));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const project = join(directory, "project files");
      const source = join(fixture, "project");
      await cp(source, project, { recursive: true });
      const git = (...args) =>
        execFileSync("git", ["-C", project, ...args], {
          env: environment,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      if (definition.git) {
        git("init", "--initial-branch=main", "--template=");
        const hooks = join(project, ".git", "empty-hooks");
        await mkdir(hooks);
        for (const [key, value] of Object.entries({
          "core.autocrlf": "false",
          "core.fsmonitor": "false",
          "core.attributesFile": gitConfig,
          "core.hooksPath": hooks,
        }))
          git("config", key, value);
        const index = (await readdir(fixture)).includes("index");
        if (index)
          await cp(join(fixture, "index"), project, { recursive: true });
        git("add", "--all");
        if (index) await cp(source, project, { recursive: true });
      }
      const env = {
        ...environment,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(offline).href}`.trim(),
        npm_config_offline: "true",
        npm_config_cache: join(root, "empty npm cache"),
      };
      for (const key of Object.keys(env)) {
        if (key.toUpperCase() === "PATH") delete env[key];
      }
      env.PATH = [
        join(consumer, "node_modules", ".bin"),
        dirname(process.execPath),
        ...(definition.withoutGit
          ? []
          : [environment.PATH ?? environment.Path ?? ""]),
      ].join(delimiter);
      const command = definition.command;
      assert.ok(
        Array.isArray(command) &&
          command.length &&
          command.every((arg) => typeof arg === "string"),
      );
      assert.ok(
        command[0] === "git-vet" ||
          (command[0] === "git" && command[1] === "vet"),
        "Fixtures must invoke git-vet or git vet.",
      );
      const before = await snapshot(directory);
      const [program, args] =
        command[0] === "git"
          ? [command[0], command.slice(1)]
          : process.platform === "win32"
            ? [process.execPath, [entry, ...command.slice(1)]]
            : [executable, command.slice(1)];
      const result = spawnSync(program, args, {
        cwd: project,
        env,
        encoding: "utf8",
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, null);
      assert.deepEqual(
        await snapshot(directory),
        before,
        "The CLI modified the fixture project or Git metadata.",
      );
      return { ...result, project };
    },
  };
}
