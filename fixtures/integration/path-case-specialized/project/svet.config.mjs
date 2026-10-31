export default {
  files: "**/*",
  checks: [
    {
      plugin: "@svet-check-path-case",
      options: {
        case: "lower",
        files: {
          case: "upper",
          exceptions: ["svet.config.mjs", "**/README.md"],
        },
        directories: { exceptions: ["API"] },
      },
    },
  ],
};
