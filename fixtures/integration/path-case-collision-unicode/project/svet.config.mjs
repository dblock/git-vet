export default {
  files: { plugin: "@svet/files-git", options: { scope: "staged" } },
  checks: ["@svet/check-path-case-collision"],
};
