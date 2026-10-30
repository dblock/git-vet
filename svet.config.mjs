export default {
  files: {
    plugin: "@svet/files-git",
    options: {
      exclude: ["fixtures/integration/**", "test/integration.test.mjs"],
    },
  },
  checks: ["@svet/check-git-index-lf"],
};
