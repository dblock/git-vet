export default {
  apiVersion: 1,
  id: "fixture/full-inventory",
  kind: "check",
  scope: "project",
  rules: ["inventory-preserved"],
  requires: ["fs.inventory"],
  async check({ selection }) {
    if (
      selection.capabilities["fs.inventory"].length !== 2 ||
      selection.candidates.length !== 1
    ) {
      throw new Error("Narrowed selection lost full inventory.");
    }
    return { findings: [] };
  },
};
