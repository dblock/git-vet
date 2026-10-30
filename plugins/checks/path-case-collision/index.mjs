import { caseFold } from "unicode-case-folding";
import { pathInventory } from "@svet/files-glob/inventory";

function options(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length
  ) {
    throw new Error("Path case collision checking does not accept options.");
  }
}

export default {
  apiVersion: 1,
  id: "path/case-collision",
  kind: "check",
  scope: "project",
  rules: ["case-collision"],
  requires: ["fs.inventory"],
  validateOptions: options,
  async check({ selection, options: supplied = {} }) {
    options(supplied);
    const groups = new Map();
    for (const entry of pathInventory(selection)) {
      const key = caseFold(entry.path.normalize("NFC")).normalize("NFC");
      const group = groups.get(key);
      if (group) group.push(entry.path);
      else groups.set(key, [entry.path]);
    }
    return {
      findings: [...groups.values()]
        .filter((paths) => paths.length > 1)
        .map((paths) => ({
          ruleId: "case-collision",
          paths,
          message:
            "Paths collide under NFC normalization and Unicode case folding.",
        })),
    };
  },
};
