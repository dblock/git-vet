import { parseEnv } from "@simple-git/argv-parser";
import { simpleGit } from "simple-git";

const decoder = new TextDecoder("utf-8", { fatal: true });

export function error(code, message, cause) {
  const result = new Error(message, { cause });
  result.code = code;
  return result;
}

export async function git(root, args, accepted = [0], configuration = []) {
  const abort = new AbortController();
  const environment = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  let response;
  let failure;
  let outputExceeded = false;
  try {
    const client = simpleGit({
      baseDir: root,
      config: [
        "core.fsmonitor=false",
        "core.quotepath=false",
        ...configuration,
      ],
      abort: abort.signal,
      completion: { onClose: true, onExit: false },
      allowEnvironment: Object.keys(environment),
      // Preserve trusted caller settings without enabling unrelated command overrides.
      unsafe: {
        ...Object.fromEntries(
          parseEnv(environment).vulnerabilities.map(({ category }) => [
            category,
            true,
          ]),
        ),
        allowUnsafeFsMonitor: true,
        allowUnsafeFilter: true,
      },
      errors(cause, result) {
        // Capture metadata before simple-git's raw() decodes it as UTF-8.
        response = {
          stdout: Buffer.concat(result.stdOut),
          stderr: Buffer.concat(result.stdErr),
          code: result.exitCode,
        };
        const detail = response.stderr.toString("utf8").trim();
        // simple-git serializes spawn errors into stderr, losing their errno.
        if (outputExceeded) {
          failure = error(
            "GIT_COMMAND_FAILED",
            "Git output exceeded 256 MiB.",
            cause,
          );
        } else if (
          result.exitCode < 0 &&
          /\bspawn git ENOENT\b/u.test(detail)
        ) {
          failure = error(
            "GIT_NOT_FOUND",
            "Git is required by the Git selector.",
            cause,
          );
        } else if (!accepted.includes(result.exitCode)) {
          failure = error(
            "GIT_COMMAND_FAILED",
            `Git ${args[0]} failed: ${detail || cause?.message || `exit ${result.exitCode}`}`,
            cause,
          );
        }
        return failure ?? (cause && result.exitCode === 0 ? cause : undefined);
      },
    }).env(environment);
    client.outputHandler((_command, stdout, stderr) => {
      for (const stream of [stdout, stderr]) {
        let size = 0;
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > 256 * 1024 * 1024) {
            outputExceeded = true;
            abort.abort();
          }
        });
      }
    });
    if (args[0] === "cat-file") {
      await client.binaryCatFile(args.slice(1));
    } else {
      await client.raw(["--no-optional-locks", "--no-pager", ...args]);
    }
    if (response === undefined) {
      throw error("GIT_COMMAND_FAILED", "Git returned no command result.");
    }
    return response;
  } catch (cause) {
    if (failure !== undefined) throw failure;
    if (["GIT_NOT_FOUND", "GIT_COMMAND_FAILED"].includes(cause.code))
      throw cause;
    throw error(
      "GIT_COMMAND_FAILED",
      `Git ${args[0]} failed: ${cause.message}`,
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
