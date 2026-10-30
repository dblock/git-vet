export default {
  apiVersion: 1,
  id: "fixture/memory",
  kind: "selector",
  async select({ options, input }) {
    if (input !== null) {
      throw new Error("This fixture is a source, not a filter.");
    }
    const bytes = new TextEncoder().encode(options.content ?? "snapshot bytes");
    const inventory = (options.paths ?? ["b.txt", "a.txt"]).map((path) => ({
      id: `memory:${path}`,
      path,
      snapshot: { kind: "memory", id: "version-1" },
      metadata: { modifiedAt: options.modifiedAt?.[path] ?? 100 },
      async read() {
        if (options.unreadable?.includes(path)) {
          throw new Error("Snapshot bytes unavailable.");
        }
        return bytes.slice();
      },
    }));
    return {
      candidates: inventory,
      capabilities: {
        "content.snapshot": true,
        "fixture.inventory": inventory,
        "fs.timestamps": true,
      },
      context: { scope: "memory-fixture" },
      decisions: [
        {
          state: "excluded",
          path: "not-scanned/",
          reason: "Fixture exclusion.",
        },
      ],
    };
  },
};
