import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export default {
  apiVersion: 1,
  id: "fixture/timestamps",
  kind: "selector",
  async validateOptions(options) {
    if (!Number.isFinite(options.since)) {
      throw new Error(
        "since must be a finite epoch timestamp in milliseconds.",
      );
    }
  },
  async select({ root, options, input }) {
    if (input !== null) {
      throw new Error(
        "This fixture discovers files; it does not filter input.",
      );
    }
    const inventory = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const path = join(root, entry.name);
      const metadata = await stat(path);
      const bytes = await readFile(path);
      inventory.push({
        id: entry.name,
        path: entry.name,
        metadata: { modifiedAt: metadata.mtimeMs },
        snapshot: {
          kind: "filesystem-fixture",
          id: `${metadata.mtimeMs}:${metadata.size}`,
        },
        async read() {
          return new Uint8Array(bytes);
        },
      });
    }
    const candidates = inventory.filter(
      (candidate) => candidate.metadata.modifiedAt >= options.since,
    );
    return {
      candidates,
      capabilities: {
        "content.snapshot": true,
        "fs.timestamps": true,
        "fs.inventory": inventory,
      },
      context: { scope: "modified-since", since: options.since },
      decisions: inventory
        .filter((candidate) => !candidates.includes(candidate))
        .map((candidate) => ({
          state: "filtered",
          path: candidate.path,
          candidateId: candidate.id,
          reason: "Modification time is before the cutoff.",
        })),
    };
  },
};
