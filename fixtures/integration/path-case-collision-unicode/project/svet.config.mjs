export default {
  files: { plugin: "@svet/files-git", options: { mode: "staged" } },
  checks: ["@svet/check-path-case-collision"],
};
