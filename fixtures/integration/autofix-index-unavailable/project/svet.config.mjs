export default {
  files: [{ plugin: "@svet/files-git", options: { scope: "staged" } }, "*.txt"],
  checks: ["@svet/check-file-eol"],
};
