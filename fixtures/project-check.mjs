export default {
  apiVersion: 1,
  id: "fixture/project",
  kind: "check",
  scope: "project",
  rules: ["project"],
  async check({ options, selection }) {
    if (options.skip) {
      return { skip: "Project intentionally skipped." };
    }
    return {
      findings: options.finding
        ? [
            {
              ruleId: "project",
              message: "Project-level finding.",
              ...(selection === null
                ? {}
                : {
                    paths: selection.candidates.map(
                      (candidate) => candidate.path,
                    ),
                  }),
            },
          ]
        : [],
    };
  },
};
