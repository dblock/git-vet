import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { glob, lstat, open } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import picomatch from "picomatch";

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
  async select({ root, options, input }) {
    const matches = matcher(options);
    if (input !== null) {
      return {
        ...input,
        candidates: input.candidates.filter((candidate) =>
          matches(candidate.path),
        ),
        decisions: input.candidates.map((candidate) => ({
          candidateId: candidate.id,
          path: candidate.path,
          state: matches(candidate.path) ? "selected" : "filtered",
          reason: `Glob ${JSON.stringify(options.pattern)} ${matches(candidate.path) ? "matched" : "did not match"}.`,
        })),
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
