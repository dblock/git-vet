export default {
  apiVersion: 1,
  id: "git/index-lf",
  kind: "check",
  scope: "file",
  rules: ["lf"],
  requires: ["git.index", "content.text"],
  validateOptions(options) {
    for (const key of Object.keys(options)) {
      throw new Error(`Unknown indexed LF check option: ${key}.`);
    }
  },
  async check({ selection, candidate }) {
    const index = selection.capabilities["git.index"];
    const text = selection.capabilities["content.text"];
    if (
      !Array.isArray(index?.entries) ||
      typeof index.read !== "function" ||
      typeof text?.isText !== "function"
    ) {
      throw new Error(
        "Indexed LF checking requires git.index entries/read(path) and content.text.isText(bytes).",
      );
    }
    const entry = index.entries.find((entry) => entry.path === candidate.path);
    if (!entry) {
      return { skip: "The selected path has no captured Git index entry." };
    }
    if (entry.stage !== 0) {
      throw new Error("Resolve unmerged index entries before checking LF.");
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
    const carriageReturn = bytes.indexOf(13);
    if (carriageReturn === -1) {
      return { findings: [] };
    }
    let line = 1;
    for (let offset = 0; offset < carriageReturn; offset++) {
      if (bytes[offset] === 10) line++;
    }
    return {
      findings: [
        {
          ruleId: "lf",
          path: candidate.path,
          location: { line },
          message:
            "Indexed text contains CRLF or CR line endings. Convert to LF and stage the intended changes manually.",
        },
      ],
    };
  },
};
