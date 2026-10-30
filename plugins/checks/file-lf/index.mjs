export default {
  apiVersion: 1,
  id: "file/lf",
  kind: "check",
  scope: "file",
  rules: ["lf"],
  requires: ["content.snapshot", "content.text"],
  validateOptions(options) {
    for (const key of Object.keys(options)) {
      throw new Error(`Unknown file LF check option: ${key}.`);
    }
  },
  async check({ selection, candidate }) {
    const text = selection.capabilities["content.text"];
    if (
      selection.capabilities["content.snapshot"] !== true ||
      typeof candidate.read !== "function" ||
      typeof text?.isText !== "function"
    ) {
      throw new Error(
        "File LF checking requires captured candidate.read() snapshots and content.text.isText(bytes).",
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
            "Selected text contains CRLF or CR line endings. Convert the intended source to LF and run the check again.",
        },
      ],
    };
  },
};
