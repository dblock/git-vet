export default {
  files: {
    plugin: "@git-vet/files-git",
    options: {
      exclude: ["fixtures/integration/**", "test/integration.test.mjs"],
    },
  },
  checks: [{ plugin: "@git-vet/check-index-lf" }],
};
