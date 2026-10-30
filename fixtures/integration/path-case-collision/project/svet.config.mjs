export default {
  files: [
    { plugin: "@svet/files-git", options: { mode: "staged" } },
    "selected.txt",
  ],
  checks: ["@svet/check-path-case-collision"],
};
