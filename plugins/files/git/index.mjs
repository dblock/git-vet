import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import picomatch from "picomatch";
import {
  commit,
  error,
  git,
  indexEntries,
  records,
  revisionChanges,
  text,
  treeEntries,
  worktreeChanges,
} from "./git.mjs";

function options(value) {
  const allowed = [
    "mode",
    "snapshot",
    "base",
    "target",
    "mergeBase",
    "includeUntracked",
    "includeIgnored",
    "exclude",
  ];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new Error(`Unknown Git selector option: ${key}.`);
  }
  const mode = value.mode === undefined ? "tracked" : value.mode;
  const snapshot =
    value.snapshot === undefined
      ? mode === "staged"
        ? "index"
        : mode === "revision"
          ? "revision"
          : "worktree"
      : value.snapshot;
  if (!["tracked", "changed", "staged", "revision"].includes(mode)) {
    throw new Error("mode must be tracked, changed, staged, or revision.");
  }
  if (
    !["worktree", "index", "revision"].includes(snapshot) ||
    (mode === "staged" && snapshot !== "index") ||
    (mode === "revision" && snapshot !== "revision") ||
    (!["staged", "revision"].includes(mode) && snapshot === "revision")
  ) {
    throw new Error(
      "The requested snapshot is incompatible with the selection mode.",
    );
  }
  for (const key of ["includeUntracked", "includeIgnored", "mergeBase"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new Error(`${key} must be a boolean.`);
    }
  }
  if (mode === "revision") {
    if (
      ![value.base, value.target].every(
        (ref) => typeof ref === "string" && ref.length,
      )
    ) {
      throw new Error(
        "revision mode requires explicit base and target references.",
      );
    }
  } else if (
    ["base", "target", "mergeBase"].some((key) => value[key] !== undefined)
  ) {
    throw new Error("base, target, and mergeBase apply only to revision mode.");
  }
  if (
    (value.includeUntracked || value.includeIgnored) &&
    snapshot !== "worktree"
  ) {
    throw new Error("Untracked/ignored files require a worktree snapshot.");
  }
  if (value.includeIgnored && !value.includeUntracked) {
    throw new Error("includeIgnored requires includeUntracked.");
  }
  if (
    value.exclude !== undefined &&
    (!Array.isArray(value.exclude) ||
      value.exclude.some(
        (pattern) => typeof pattern !== "string" || !pattern.length,
      ))
  ) {
    throw new Error("exclude must be an array of nonempty glob patterns.");
  }
  return {
    ...value,
    mode,
    snapshot,
    excluded: value.exclude?.length
      ? picomatch(value.exclude, {
          dot: true,
          windows: false,
          strictBrackets: true,
        })
      : () => false,
  };
}

function order(a, b) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function isText(bytes) {
  return !bytes.subarray(0, 8000).includes(0);
}

async function worktreeBytes(root, path) {
  const filename = join(root, path);
  if (!(await lstat(filename)).isFile()) {
    throw error(
      "GIT_CONTENT_UNAVAILABLE",
      "The working-tree path is not a regular file.",
    );
  }
  const handle = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!(await handle.stat()).isFile()) {
      throw error(
        "GIT_CONTENT_UNAVAILABLE",
        "The opened path is not a regular file.",
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function local(root) {
  const index = indexEntries(
    (await git(root, ["ls-files", "--stage", "-z"])).stdout,
  );
  if (index.some((entry) => entry.stage !== 0)) {
    throw error(
      "GIT_UNMERGED_INDEX",
      "Resolve unmerged index entries before selecting files.",
    );
  }
  const filters = records(
    (
      await git(
        root,
        [
          "config",
          "--null",
          "--name-only",
          "--get-regexp",
          "^filter\\..*\\.(clean|smudge|process|required)$",
        ],
        [0, 1],
      )
    ).stdout,
  );
  const drivers = new Set(
    filters.map((key) => key.slice(7, key.lastIndexOf("."))),
  );
  const disabledFilters = [...drivers].flatMap((driver) =>
    ["clean", "smudge", "process", "required"].flatMap((setting) => [
      "-c",
      `filter.${driver}.${setting}=${setting === "required" ? "false" : ""}`,
    ]),
  );
  const status = worktreeChanges(
    (
      await git(
        root,
        [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
          "--ignored=matching",
          "--ignore-submodules=all",
          "--find-renames=50%",
        ],
        [0],
        disabledFilters,
      )
    ).stdout,
  );
  const head = await git(
    root,
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    [0, 1],
  );
  return {
    entries: index,
    ...status,
    baseline: head.code === 1 ? null : text(head.stdout).trim(),
  };
}

async function revisions(root, settings) {
  let base = await commit(root, settings.base);
  const target = await commit(root, settings.target);
  if (settings.mergeBase) {
    const result = await git(root, ["merge-base", base, target], [0, 1]);
    if (result.code !== 0) {
      throw error(
        "GIT_BASELINE_UNAVAILABLE",
        "No merge base is available locally; shallow/unrelated history is not fetched.",
      );
    }
    base = text(result.stdout).trim();
  }
  return {
    entries: treeEntries(
      (await git(root, ["ls-tree", "-r", "-z", "--full-tree", target])).stdout,
    ),
    changes: revisionChanges(
      (
        await git(root, [
          "diff",
          "--name-status",
          "-z",
          "--find-renames=50%",
          "--no-ext-diff",
          "--no-textconv",
          base,
          target,
          "--",
        ])
      ).stdout,
    ),
    untracked: [],
    ignored: [],
    baseline: base,
    target,
  };
}

async function select({ root, options: supplied, input }) {
  if (input !== null) {
    throw error(
      "GIT_SOURCE_ONLY",
      "The Git selector discovers candidates; use a separate filter to narrow its output.",
    );
  }
  const settings = options(supplied);
  let repositoryRoot;
  try {
    const output = text(
      (await git(root, ["rev-parse", "--show-toplevel"])).stdout,
    );
    repositoryRoot = output.slice(0, -1);
    if (process.platform === "win32" && repositoryRoot.endsWith("\r")) {
      repositoryRoot = repositoryRoot.slice(0, -1);
    }
    repositoryRoot = resolve(repositoryRoot);
  } catch (cause) {
    if (cause.code === "GIT_NOT_FOUND") throw cause;
    throw error(
      "GIT_NOT_REPOSITORY",
      "The Git selector requires a working-tree repository.",
      cause,
    );
  }
  const state =
    settings.mode === "revision"
      ? await revisions(repositoryRoot, settings)
      : await local(repositoryRoot);
  const entries = new Map(state.entries.map((entry) => [entry.path, entry]));
  const decisions = [];
  const ignoredFiles = settings.includeIgnored
    ? records(
        (
          await git(repositoryRoot, [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
          ])
        ).stdout,
      )
    : [];
  const ignoredSet = new Set(ignoredFiles);
  for (const path of [...state.untracked, ...ignoredFiles]) {
    if (!entries.has(path)) {
      entries.set(path, {
        path,
        untracked: true,
        ignored: ignoredSet.has(path),
      });
    }
  }
  const candidates = [];
  const inventory = [];
  const directories = new Set();
  for (const entry of [...entries.values()].sort(order)) {
    const change = state.changes.get(entry.path);
    const record = {
      id: `git:file:${entry.path}`,
      path: entry.path,
      metadata: {
        kind: entry.untracked
          ? "untracked"
          : entry.mode === "160000"
            ? "submodule"
            : entry.mode === "120000"
              ? "symlink"
              : "file",
        git: {
          status: entry.untracked
            ? "untracked"
            : (change?.status ?? "unchanged"),
          ...(entry.mode === undefined ? {} : { mode: entry.mode }),
          ...(entry.oid ? { oid: entry.oid } : {}),
          ...(change ?? {}),
          ...(entry.untracked ? { ignored: Boolean(entry.ignored) } : {}),
        },
      },
    };
    if (
      !entry.untracked ||
      (settings.includeUntracked && (!entry.ignored || settings.includeIgnored))
    ) {
      inventory.push(record);
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i++)
        directories.add(parts.slice(0, i).join("/"));
    }
    const decision = (state, reason) =>
      decisions.push({
        state,
        reason,
        path: entry.path,
        candidateId: record.id,
      });
    if (
      entry.untracked &&
      (!settings.includeUntracked ||
        (entry.ignored && !settings.includeIgnored))
    ) {
      decision(
        "excluded",
        entry.ignored ? "Ignored untracked path." : "Untracked path.",
      );
      continue;
    }
    const changed =
      settings.mode === "staged"
        ? change &&
          ["added", "modified", "renamed"].includes(change.indexStatus)
        : change && change.status !== "unchanged";
    if (settings.mode !== "tracked" && !entry.untracked && !changed) {
      decision("filtered", "Outside the configured change scope.");
      continue;
    }
    if (settings.excluded(entry.path)) {
      decision("excluded", "Matched a configured exclusion glob.");
      continue;
    }
    if (!entry.untracked && !entry.mode.startsWith("100")) {
      decision(
        "excluded",
        "Symlinks and submodules are not regular file content.",
      );
      continue;
    }
    let bytes;
    try {
      bytes =
        settings.snapshot === "worktree"
          ? await worktreeBytes(repositoryRoot, entry.path)
          : (await git(repositoryRoot, ["cat-file", "blob", entry.oid])).stdout;
    } catch (cause) {
      if (
        settings.snapshot === "worktree" &&
        ["ENOENT", "ELOOP", "GIT_CONTENT_UNAVAILABLE"].includes(cause.code)
      ) {
        decision(
          "unavailable",
          "Working-tree content is missing or not a regular file.",
        );
        continue;
      }
      throw error(
        "GIT_CONTENT_UNAVAILABLE",
        `Cannot read selected content for ${entry.path}.`,
        cause,
      );
    }
    record.metadata.text = isText(bytes);
    record.metadata.kind = "file";
    record.snapshot = {
      kind: `git-${settings.snapshot}`,
      id:
        settings.snapshot === "worktree"
          ? createHash("sha256").update(bytes).digest("hex")
          : entry.oid,
    };
    if (!record.metadata.text) {
      decision("filtered", "Binary content: NUL byte in the first 8000 bytes.");
      continue;
    }
    record.read = async () => new Uint8Array(bytes);
    candidates.push(record);
    decision("selected", `Selected ${settings.snapshot} text content.`);
  }
  for (const path of directories) {
    inventory.push({
      id: `git:directory:${path}`,
      path,
      metadata: { kind: "directory" },
    });
  }
  for (const path of settings.includeIgnored ? [] : state.ignored) {
    decisions.push({
      state: "excluded",
      path,
      reason: path.endsWith("/")
        ? "Ignored directory reported by Git; descendants were not enumerated unless requested."
        : "Ignored untracked path.",
    });
  }
  for (const change of state.changes.values()) {
    if (!entries.has(change.path)) {
      decisions.push({
        state: "unavailable",
        path: change.path,
        reason: "Deleted path is absent from the selected snapshot inventory.",
      });
    }
  }
  const capabilities = {
    "content.snapshot": true,
    "content.text": { isText },
    "fs.inventory": inventory.sort(order),
    "git.changes": {
      baseline: state.baseline,
      ...(state.target ? { target: state.target } : {}),
      entries: [...state.changes.values()].sort(order),
    },
  };
  if (settings.mode !== "revision") {
    const captured = new Map(state.entries.map((entry) => [entry.path, entry]));
    capabilities["git.index"] = {
      entries: state.entries.map((entry) => ({ ...entry })),
      async read(path) {
        const entry = captured.get(path);
        if (!entry || !entry.mode.startsWith("100")) {
          throw error(
            "GIT_INDEX_UNAVAILABLE",
            `No regular indexed blob for ${path}.`,
          );
        }
        return new Uint8Array(
          (await git(repositoryRoot, ["cat-file", "blob", entry.oid])).stdout,
        );
      },
    };
  }
  return {
    candidates,
    capabilities,
    decisions,
    context: {
      repositoryRoot,
      mode: settings.mode,
      snapshot: settings.snapshot,
      baseline: state.baseline,
      ...(state.target
        ? { target: state.target, mergeBase: settings.mergeBase ?? false }
        : {}),
    },
  };
}

export default {
  apiVersion: 1,
  id: "git/tracked-text",
  kind: "selector",
  validateOptions(value) {
    options(value);
  },
  select,
};
