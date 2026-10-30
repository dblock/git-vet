import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function error(code, message, cause) {
  const result = new Error(message, { cause });
  result.code = code;
  return result;
}

export async function git(root, args, accepted = [0], configuration = []) {
  try {
    const result = await execute(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        ...configuration,
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    return { ...result, code: 0 };
  } catch (cause) {
    if (accepted.includes(cause.code)) {
      return { stdout: cause.stdout, stderr: cause.stderr, code: cause.code };
    }
    if (cause.code === "ENOENT") {
      throw error(
        "GIT_NOT_FOUND",
        "Git is required by the Git selector.",
        cause,
      );
    }
    throw error(
      "GIT_COMMAND_FAILED",
      `Git ${args[0]} failed: ${cause.stderr?.toString("utf8").trim() || cause.message}`,
      cause,
    );
  }
}

export function text(buffer) {
  try {
    return decoder.decode(buffer);
  } catch (cause) {
    throw error(
      "GIT_PATH_ENCODING",
      "Git returned a path that cannot be represented as UTF-8.",
      cause,
    );
  }
}

export function records(buffer) {
  const value = text(buffer);
  return value === "" ? [] : value.slice(0, -1).split("\0");
}

export async function commit(root, reference) {
  try {
    return text(
      (
        await git(root, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${reference}^{commit}`,
        ])
      ).stdout,
    ).trim();
  } catch (cause) {
    throw error(
      "GIT_INVALID_REFERENCE",
      `Cannot resolve commit ${reference}.`,
      cause,
    );
  }
}

export function indexEntries(buffer) {
  return records(buffer).map((record) => {
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    return { path: record.slice(tab + 1), mode, oid, stage: Number(stage) };
  });
}

export function treeEntries(buffer) {
  return records(buffer).map((record) => {
    const tab = record.indexOf("\t");
    const [mode, , oid] = record.slice(0, tab).split(" ");
    return { path: record.slice(tab + 1), mode, oid, stage: 0 };
  });
}

function status(code) {
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (/[MT]/u.test(code)) return "modified";
  if (code.includes("U")) return "unmerged";
  return "unchanged";
}

export function worktreeChanges(buffer) {
  const tokens = records(buffer);
  const changes = new Map();
  const untracked = [];
  const ignored = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("? ")) {
      untracked.push(token.slice(2));
    } else if (token.startsWith("! ")) {
      ignored.push(token.slice(2));
    } else {
      const fields = token.split(" ");
      const renamed = fields[0] === "2";
      const path = fields
        .slice(renamed ? 9 : fields[0] === "u" ? 10 : 8)
        .join(" ");
      const code = fields[1];
      changes.set(path, {
        path,
        status: status(code),
        indexStatus: status(code[0]),
        worktreeStatus: status(code[1]),
        ...(renamed ? { oldPath: tokens[++i] } : {}),
      });
    }
  }
  return { changes, untracked, ignored };
}

export function revisionChanges(buffer) {
  const tokens = records(buffer);
  const changes = new Map();
  for (let i = 0; i < tokens.length;) {
    const code = tokens[i++];
    const oldPath = tokens[i++];
    const path =
      code.startsWith("R") || code.startsWith("C") ? tokens[i++] : oldPath;
    changes.set(path, {
      path,
      status: status(code),
      ...(code.startsWith("R") || code.startsWith("C") ? { oldPath } : {}),
    });
  }
  return changes;
}
