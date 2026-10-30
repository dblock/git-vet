export default {
  apiVersion: 1,
  id: "fixture/recent",
  kind: "selector",
  async select({ options, input }) {
    if (input === null || !Object.hasOwn(input.capabilities, "fs.timestamps")) {
      throw new Error("The recent filter requires timestamped input.");
    }
    const candidates = input.candidates.filter(
      (candidate) => candidate.metadata.modifiedAt >= options.since,
    );
    return {
      candidates,
      capabilities: input.capabilities,
      decisions: input.candidates
        .filter((candidate) => !candidates.includes(candidate))
        .map((candidate) => ({
          state: "filtered",
          candidateId: candidate.id,
          path: candidate.path,
          reason: "Before the configured cutoff.",
        })),
    };
  },
};
