function characters(options) {
  for (const key of Object.keys(options)) {
    if (key !== "whitespace") {
      throw new Error(`Unknown file trailing-whitespace check option: ${key}.`);
    }
  }
  const values =
    options.whitespace === undefined ? ["space", "tab"] : options.whitespace;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "Trailing-whitespace check whitespace must be a non-empty array.",
    );
  }
  const result = new Set();
  for (const value of values) {
    const character = value === "space" ? " " : value === "tab" ? "\t" : value;
    if (
      typeof character !== "string" ||
      [...character].length !== 1 ||
      character === "\r" ||
      character === "\n" ||
      (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff)
    ) {
      throw new Error(
        "Each whitespace entry must be space, tab, or one Unicode character other than CR or LF.",
      );
    }
    result.add(character);
  }
  return [...result].map((character) => new TextEncoder().encode(character));
}

export default {
  apiVersion: 1,
  id: "file/trailing-whitespace",
  kind: "check",
  scope: "file",
  rules: ["trailing-whitespace"],
  requires: ["content.snapshot", "content.text"],
  validateOptions(options) {
    characters(options);
  },
  async check({ selection, candidate, options = {} }) {
    const patterns = characters(options);
    const text = selection.capabilities["content.text"];
    if (
      selection.capabilities["content.snapshot"] !== true ||
      typeof candidate.read !== "function" ||
      typeof text?.isText !== "function"
    ) {
      throw new Error(
        "Trailing-whitespace checking requires captured candidate.read() snapshots and content.text.isText(bytes).",
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
    let start = 0;
    for (let offset = 0, line = 1; offset <= bytes.length; offset++) {
      const byte = bytes[offset];
      if (offset !== bytes.length && byte !== 10 && byte !== 13) continue;
      if (
        patterns.some(
          (pattern) =>
            offset - pattern.length >= start &&
            pattern.every(
              (byte, index) => bytes[offset - pattern.length + index] === byte,
            ),
        )
      ) {
        return {
          findings: [
            {
              ruleId: "trailing-whitespace",
              path: candidate.path,
              location: { line },
              message:
                "Selected text contains trailing whitespace. Remove it from the intended source and run the check again.",
            },
          ],
        };
      }
      if (byte === 13 && bytes[offset + 1] === 10) offset++;
      start = offset + 1;
      line++;
    }
    return { findings: [] };
  },
};
