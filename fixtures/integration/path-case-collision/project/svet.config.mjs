export default {
  files: [
    { plugin: "@svet-files-git", options: { scope: "staged" } },
    "selected.txt",
  ],
  checks: ["@svet-check-path-case-collision"],
};
