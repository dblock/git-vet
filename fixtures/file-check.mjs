export default {
  apiVersion: 1,
  id: "fixture/file",
  kind: "check",
  scope: "file",
  rules: ["example"],
  requires: ["content.snapshot"],
  async validateOptions(options) {
    await Promise.resolve();
    if (options.invalid) {
      throw new Error("Invalid fixture options.");
    }
  },
  async check({ options, candidate }) {
    if (options.skip) {
      return { skip: "Fixture does not inspect this content." };
    }
    await candidate.read();
    if (options.invalidResult) {
      return { findings: [{ ruleId: "undeclared", message: "Invalid." }] };
    }
    return {
      findings: options.clean
        ? []
        : [
            {
              ruleId: "example",
              message: "Example finding.",
              severity: "warning",
              path: candidate.path,
              location: { line: 1, column: 1 },
            },
          ],
    };
  },
};
