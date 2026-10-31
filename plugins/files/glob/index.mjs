import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { glob, lstat, open } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import picomatch from "picomatch";
import { createFixer } from "./fixes.mjs";

function matcher(options) {
  if (
    typeof options.pattern !== "string" ||
    !options.pattern.trim().length ||
    isAbsolute(options.pattern) ||
    /^[a-zA-Z]:/.test(options.pattern) ||
    options.pattern.split("/").includes("..")
  ) {
    throw new Error("A glob must be a nonempty, root-relative POSIX pattern.");
  }
  for (const key of Object.keys(options)) {
    if (key !== "pattern") throw new Error(`Unknown glob option: ${key}.`);
  }
  return picomatch(options.pattern, { windows: false, strictBrackets: true });
}

function isText(bytes) {
  return !bytes.subarray(0, 8000).includes(0);
}

async function* paths(root, pattern, matches) {
  const links = new Set();
  const found = new Set();
  const path = (entry) =>
    relative(root, join(entry.parentPath, entry.name)).split(sep).join("/") ||
    ".";
  for await (const entry of glob(pattern, {
    cwd: root,
    withFileTypes: true,
    exclude(entry) {
      if (!entry.isSymbolicLink()) return false;
      const name = path(entry);
      if (matches(name)) links.add(name);
      // Do not traverse links, including Node 22's globstar file-link edge case.
      return true;
    },
  })) {
    const name = path(entry);
    found.add(name);
    yield name;
  }
  for (const name of links) {
    if (!found.has(name)) yield name;
  }
}

async function snapshot(path) {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error("A glob content snapshot requires a regular file.");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export default {
  apiVersion: 1,
  id: "files/glob",
  kind: "selector",
  validateOptions(options) {
    matcher(options);
  },
  async select({ root, options, input, fix = false }) {
    const matches = matcher(options);
    if (input !== null) {
      const negated = picomatch.scan(options.pattern).negated;
      const targets = input.targets?.filter((target) =>
        target.oldPath === undefined
          ? matches(target.path)
          : negated
            ? matches(target.path) && matches(target.oldPath)
            : matches(target.path) || matches(target.oldPath),
      );
      const targetPaths =
        targets === undefined
          ? undefined
          : new Set(targets.map((target) => target.path));
      const targetSet = new Set(targets);
      const candidatePaths = new Set(
        input.candidates.map((candidate) => candidate.path),
      );
      const selected =
        targets === undefined
          ? (candidate) => matches(candidate.path)
          : (candidate) => targetPaths.has(candidate.path);
      return {
        ...input,
        ...(targets === undefined ? {} : { targets }),
        candidates: input.candidates.filter(selected),
        decisions: [
          ...input.candidates.map((candidate) => ({
            candidateId: candidate.id,
            path: candidate.path,
            state: selected(candidate) ? "selected" : "filtered",
            reason: `Glob ${JSON.stringify(options.pattern)} ${selected(candidate) ? "matched" : "did not match"}.`,
          })),
          ...(input.targets ?? [])
            .filter((target) => !candidatePaths.has(target.path))
            .map((target) => ({
              path: target.path,
              state: targetSet.has(target) ? "selected" : "filtered",
              reason: `Glob ${JSON.stringify(options.pattern)} ${targetSet.has(target) ? "matched" : "did not match"}.`,
            })),
        ],
      };
    }
    if (picomatch.scan(options.pattern).negated) {
      throw new Error(
        "A leading glob must be positive; negated globs require an earlier file source.",
      );
    }
    const candidates = [];
    const decisions = [];
    const inventory = new Map();
    const fixer = fix ? await createFixer(root) : undefined;
    for await (const path of paths(root, options.pattern, matches)) {
      const filename = join(root, path);
      const info = await lstat(filename);
      const kind = info.isFile()
        ? "file"
        : info.isDirectory()
          ? "directory"
          : info.isSymbolicLink()
            ? "symlink"
            : "special";
      const record = { id: `glob:${path}`, path, metadata: { kind } };
      inventory.set(path, record);
      for (
        let parent = posix.dirname(path);
        parent !== ".";
        parent = posix.dirname(parent)
      ) {
        if (!inventory.has(parent)) {
          inventory.set(parent, {
            id: `glob:${parent}`,
            path: parent,
            metadata: { kind: "directory" },
          });
        }
      }
      if (kind !== "file") {
        decisions.push({
          path,
          state: "excluded",
          reason: "Only regular files provide glob content snapshots.",
        });
        continue;
      }
      const bytes = await snapshot(filename);
      record.metadata.text = isText(bytes);
      record.snapshot = {
        kind: "filesystem",
        id: createHash("sha256").update(bytes).digest("hex"),
      };
      record.read = async () => new Uint8Array(bytes);
      if (fixer) await fixer.capture(record, bytes);
      candidates.push(record);
      decisions.push({
        path,
        candidateId: record.id,
        state: "selected",
        reason: "Matched the filesystem glob.",
      });
    }
    const order = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return {
      candidates: candidates.sort(order),
      ...(fixer ? { fixer: fixer.writer } : {}),
      capabilities: {
        "content.snapshot": true,
        "content.text": { isText },
        "fs.inventory": [...inventory.values()].sort(order),
      },
      decisions,
      context: { root, pattern: options.pattern, snapshot: "filesystem" },
    };
  },
};
