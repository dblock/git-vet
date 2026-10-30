import assert from "node:assert/strict";
import { test } from "node:test";
import check from "@svet/check-path-case";

function selection(paths) {
  return {
    candidates: [],
    capabilities: {
      "fs.inventory": paths.map((path) =>
        typeof path === "string"
          ? {
              path,
              metadata: { kind: "file", text: false },
              read() {
                throw new Error("Names must not read content.");
              },
            }
          : path,
      ),
    },
  };
}

async function inspect(paths, options = {}) {
  check.validateOptions(options);
  return (
    await check.check({ selection: selection(paths), options })
  ).findings.map((finding) => finding.path);
}

test("lowercase shorthand checks every name, deriving and deduplicating parent directories without content reads", async () => {
  assert.deepEqual(
    await inspect([
      "Src/README.MD",
      "Src/User.tsx",
      ".GitHub/Config.YML",
      "src/clean.js",
      { path: "Src", metadata: { kind: "directory" } },
      { path: "Modules", metadata: { kind: "submodule" } },
      { path: "Link", metadata: { kind: "symlink" } },
      { path: "New.txt", metadata: { kind: "untracked" } },
      { path: "PIPE", metadata: { kind: "special" } },
    ]),
    [
      ".GitHub",
      ".GitHub/Config.YML",
      "Link",
      "Modules",
      "New.txt",
      "PIPE",
      "Src",
      "Src/README.MD",
      "Src/User.tsx",
    ],
  );
  assert.deepEqual(
    await inspect([
      "lower/straße.txt",
      "αβ.txt",
      "i\u0307.txt",
      "e\u0301.txt",
      "123-_😀.txt",
    ]),
    [],
  );
  assert.deepEqual(await inspect(["É/Σ.TXT", "İ.TXT"], { case: "upper" }), []);
  assert.deepEqual(await inspect(["É/Σ.TXT", "İ.TXT"]), [
    "É",
    "É/Σ.TXT",
    "İ.TXT",
  ]);
});

test("shared case defaults support independent file/directory overrides and disabling either category", async () => {
  const paths = ["D/a.txt", "D/B.TXT", "d/c.txt"];
  for (const [options, expected] of [
    [
      { case: "lower", files: { case: "upper" }, directories: false },
      ["D/a.txt", "d/c.txt"],
    ],
    [
      {
        case: "upper",
        files: { case: "lower" },
        directories: { case: "lower" },
      },
      ["D", "D/B.TXT"],
    ],
    [{ files: false }, ["D"]],
    [{ case: "upper", directories: false }, ["D/a.txt", "d/c.txt"]],
  ]) {
    assert.deepEqual(await inspect(paths, options), expected);
  }
});

test("exception globs are case-sensitive, include dotfiles, replace inherited arrays, and never exempt ancestors", async () => {
  const paths = ["D/a.txt", "D/B.TXT", "d/c.txt"];
  const options = { exceptions: ["D", "D/B.TXT"] };
  assert.deepEqual(await inspect(paths, options), []);
  assert.deepEqual(
    await inspect(paths, { ...options, files: { exceptions: [] } }),
    ["D/B.TXT"],
  );
  assert.deepEqual(
    await inspect(paths, { ...options, directories: { exceptions: [] } }),
    ["D"],
  );
  assert.deepEqual(
    await inspect([".Hidden/README.md", "README.md"], {
      files: { exceptions: ["**/README.md"] },
    }),
    [".Hidden"],
  );
  assert.deepEqual(
    await inspect(["README.md"], { exceptions: ["readme.md"] }),
    ["README.md"],
  );
  assert.deepEqual(await inspect(["D/lower.txt"], { exceptions: ["D"] }), []);
});

test("invalid casing, category options, and exception globs fail rather than silently relaxing policies", () => {
  for (const options of [
    null,
    [],
    true,
    { casing: "lower" },
    { case: null },
    { case: "LOWER" },
    { case: "camel" },
    { files: true },
    { files: "lower" },
    { directories: null },
    { files: { case: false } },
    { files: { unknown: true } },
    { files: false, directories: false },
    { exceptions: null },
    { exceptions: "README.md" },
    { exceptions: [1] },
    ...["", " ", "/absolute", "C:/file", "../outside", "!README.md", "["].map(
      (pattern) => ({ exceptions: [pattern] }),
    ),
    { directories: { exceptions: ["../outside"] } },
  ]) {
    assert.throws(() => check.validateOptions(options));
  }
});
