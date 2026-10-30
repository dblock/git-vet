function expectedEnding(options) {
  for (const key of Object.keys(options)) {
    if (key !== "eol") {
      throw new Error(`Unknown indexed EOL check option: ${key}.`);
    }
  }
  const eol = options.eol === undefined ? "lf" : options.eol;
  if (!["lf", "cr", "crlf", "cr-lf"].includes(eol)) {
    throw new Error("Indexed EOL check eol must be lf, cr, crlf, or cr-lf.");
  }
  return eol === "cr-lf" ? "CRLF" : eol.toUpperCase();
}

export default {
  apiVersion: 1,
  id: "git/index-eol",
  kind: "check",
  scope: "file",
  rules: ["eol"],
  requires: ["git.index", "content.text"],
  validateOptions(options) {
    expectedEnding(options);
  },
  async check({ selection, candidate, options = {} }) {
    const expected = expectedEnding(options);
    const index = selection.capabilities["git.index"];
    const text = selection.capabilities["content.text"];
    if (
      !Array.isArray(index?.entries) ||
      typeof index.read !== "function" ||
      typeof text?.isText !== "function"
    ) {
      throw new Error(
        "Indexed EOL checking requires git.index entries/read(path) and content.text.isText(bytes).",
      );
    }
    const entry = index.entries.find((entry) => entry.path === candidate.path);
    if (!entry) {
      return { skip: "The selected path has no captured Git index entry." };
    }
    if (entry.stage !== 0) {
      throw new Error("Resolve unmerged index entries before checking EOL.");
    }
    if (typeof entry.mode !== "string") {
      throw new Error("The captured Git index entry has no valid mode.");
    }
    if (!entry.mode.startsWith("100")) {
      return { skip: "The selected path is not a regular Git index blob." };
    }
    const bytes = await index.read(candidate.path);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("git.index.read(path) must return Uint8Array bytes.");
    }
    const isText = text.isText(bytes);
    if (typeof isText !== "boolean") {
      throw new Error("content.text.isText(bytes) must return a boolean.");
    }
    if (!isText) {
      return { skip: "The captured Git index blob is binary." };
    }
    for (let offset = 0, line = 1; offset < bytes.length; offset++) {
      if (bytes[offset] !== 10 && bytes[offset] !== 13) continue;
      const actual =
        bytes[offset] === 10 ? "LF" : bytes[offset + 1] === 10 ? "CRLF" : "CR";
      if (actual !== expected) {
        return {
          findings: [
            {
              ruleId: "eol",
              path: candidate.path,
              location: { line },
              message: `Indexed text contains ${actual} line endings; expected ${expected}. Convert to ${expected} and stage the intended changes manually.`,
            },
          ],
        };
      }
      if (actual === "CRLF") offset++;
      line++;
    }
    return { findings: [] };
  },
};
