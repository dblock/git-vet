export default {
  files: {
    plugin: "@svet/files-git",
    options: {
      exclude: ["fixtures/integration/**", "test/integration.test.mjs"],
    },
  },
  checks: [{ plugin: "@svet/check-git-index-lf" }],
};
