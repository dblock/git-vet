export default {
  apiVersion: 1,
  id: "fixture/word",
  kind: "check",
  scope: "file",
  rules: ["forbidden-word"],
  requires: ["content.snapshot"],
  async check({ candidate }) {
    const text = new TextDecoder().decode(await candidate.read());
    return {
      findings: text.includes("bad")
        ? [
            {
              ruleId: "forbidden-word",
              path: candidate.path,
              message: "Forbidden word.",
            },
          ]
        : [],
    };
  },
};
