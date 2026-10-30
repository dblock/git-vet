function expectedEnding(options) {
  for (const key of Object.keys(options)) {
    if (key !== "eol")
      throw new Error(`Unknown file EOL check option: ${key}.`);
  }
  const eol = options.eol === undefined ? "lf" : options.eol;
  if (!["lf", "cr", "crlf", "cr-lf"].includes(eol)) {
    throw new Error("File EOL check eol must be lf, cr, crlf, or cr-lf.");
  }
  return eol === "cr-lf" ? "CRLF" : eol.toUpperCase();
}

export default {
  apiVersion: 1,
  id: "file/eol",
  kind: "check",
  scope: "file",
  rules: ["eol"],
  fixable: true,
  requires: ["content.snapshot", "content.text"],
  validateOptions(options) {
    expectedEnding(options);
  },
  async check({ selection, candidate, options = {}, fix = false }) {
    const expected = expectedEnding(options);
    const text = selection.capabilities["content.text"];
    if (
      selection.capabilities["content.snapshot"] !== true ||
      typeof candidate.read !== "function" ||
      typeof text?.isText !== "function"
    ) {
      throw new Error(
        "File EOL checking requires captured candidate.read() snapshots and content.text.isText(bytes).",
      );
    }
    const bytes = await candidate.read();
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("candidate.read() must return Uint8Array bytes.");
    }
    const isText = text.isText(bytes);
    if (typeof isText !== "boolean") {
      throw new Error("content.text.isText(bytes) must return a boolean.");
    }
    if (!isText) {
      return { skip: "The selected content snapshot is binary." };
    }
    const findings = [];
    const edits = [];
    const replacement = new TextEncoder().encode(
      expected === "LF" ? "\n" : expected === "CR" ? "\r" : "\r\n",
    );
    for (let offset = 0, line = 1; offset < bytes.length; offset++) {
      if (bytes[offset] !== 10 && bytes[offset] !== 13) continue;
      const actual =
        bytes[offset] === 10 ? "LF" : bytes[offset + 1] === 10 ? "CRLF" : "CR";
      if (actual !== expected) {
        if (!findings.length) {
          findings.push({
            ruleId: "eol",
            path: candidate.path,
            location: { line },
            message: `Selected text contains ${actual} line endings; expected ${expected}. Convert the intended source to ${expected} and run the check again.`,
          });
        }
        if (!fix) return { findings };
        edits.push({
          start: offset,
          end: offset + (actual === "CRLF" ? 2 : 1),
          replacement,
        });
      }
      if (actual === "CRLF") offset++;
      line++;
    }
    return { findings, ...(fix ? { edits } : {}) };
  },
};
