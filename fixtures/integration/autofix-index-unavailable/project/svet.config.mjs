export default {
  files: [{ plugin: "@svet/files-git", options: { mode: "staged" } }, "*.txt"],
  checks: ["@svet/check-file-eol"],
};
