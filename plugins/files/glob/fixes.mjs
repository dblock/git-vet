import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function createFixer(root) {
  const directory = await realpath(root);
  const targets = new Map();
  async function info(filename) {
    const path = relative(directory, filename);
    assert(
      path && !isAbsolute(path) && !path.split(sep).includes(".."),
      "Fix targets must remain inside the selected root.",
    );
    let parent = directory;
    for (const component of path.split(sep).slice(0, -1)) {
      parent = join(parent, component);
      assert(
        (await lstat(parent)).isDirectory(),
        "Fix target parents must be real directories.",
      );
    }
    const stat = await lstat(filename);
    assert(
      stat.isFile() && stat.nlink === 1,
      "Fix targets must be regular files without hard links.",
    );
    assert((stat.mode & 0o222) !== 0, "Fix targets must be writable.");
    assert(
      (stat.mode & 0o7000) === 0,
      "Fix targets with special permission bits are unsupported.",
    );
    if (typeof process.getuid === "function") {
      assert(
        stat.uid === process.getuid(),
        "Fix targets must be owned by the invoking user.",
      );
    }
    return stat;
  }
  async function validate({ candidate, original }) {
    const target = targets.get(candidate);
    assert(
      target && Buffer.from(original).equals(target.bytes),
      "Fixes must use a registered captured snapshot.",
    );
    const current = await info(target.filename);
    assert(
      current.dev === target.stat.dev &&
        current.ino === target.stat.ino &&
        current.mode === target.stat.mode,
      "Fix target identity or permissions changed since selection.",
    );
    const handle = await open(
      target.filename,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      assert(
        opened.dev === current.dev && opened.ino === current.ino,
        "Fix target changed while opening.",
      );
      assert(
        (await handle.readFile()).equals(target.bytes),
        "Fix target contents changed since selection.",
      );
    } finally {
      await handle.close();
    }
  }
  return {
    async capture(candidate, bytes) {
      const filename = resolve(directory, candidate.path);
      targets.set(candidate, {
        filename,
        bytes: Buffer.from(bytes),
        stat: await lstat(filename),
      });
    },
    writer: {
      validate,
      async apply(request) {
        await validate(request);
        const target = targets.get(request.candidate);
        const temporary = join(
          dirname(target.filename),
          `.svet-${randomUUID()}.tmp`,
        );
        let created = false;
        try {
          const handle = await open(temporary, "wx", target.stat.mode & 0o777);
          created = true;
          try {
            await handle.writeFile(request.replacement);
            await handle.chmod(target.stat.mode & 0o777);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await validate(request);
          await rename(temporary, target.filename);
          created = false;
        } finally {
          if (created) await unlink(temporary);
        }
      },
    },
  };
}
