import assert from "node:assert/strict";
import { test } from "node:test";
import check from "@svet/check-path-case-collision";
import casing from "@svet/check-path-case";

function selection(paths) {
  return {
    candidates: [],
    capabilities: {
      "fs.inventory": paths.map((path) =>
        typeof path === "string"
          ? {
              path,
              metadata: { kind: "file" },
              read() {
                throw new Error("Collision checking must not read content.");
              },
            }
          : path,
      ),
    },
  };
}

async function groups(paths) {
  return (await check.check({ selection: selection(paths) })).findings.map(
    (finding) => finding.paths,
  );
}

test("complete deterministic groups include file, directory, and file-versus-directory collisions", async () => {
  const paths = [
    "foo.txt",
    "Foo.txt",
    "FOO.txt",
    "Src/a.js",
    "src/b.js",
    "File",
    "file/a.js",
    "Foo.txt",
  ];
  const expected = [
    ["FOO.txt", "Foo.txt", "foo.txt"],
    ["File", "file"],
    ["Src", "src"],
  ];
  assert.deepEqual(await groups(paths), expected);
  assert.deepEqual(await groups([...paths].reverse()), expected);
  assert.deepEqual(await groups(["A/b", "a/B"]), [
    ["A", "a"],
    ["A/b", "a/B"],
  ]);
  assert.deepEqual(
    await groups(["same.txt", "same.txt", "src/a", "src/b"]),
    [],
  );
});

test("NFC plus full Unicode folding detects canonical equivalents, expansions, sigma and dotted I without locale rules", async () => {
  for (const [paths, expected] of [
    [["café.txt", "cafe\u0301.txt"], [["cafe\u0301.txt", "café.txt"]]],
    [
      ["Straße.txt", "STRASSE.TXT", "strasse.txt"],
      [["STRASSE.TXT", "Straße.txt", "strasse.txt"]],
    ],
    [["Σ.txt", "σ.txt", "ς.txt"], [["Σ.txt", "ς.txt", "σ.txt"]]],
    [["K.txt", "K.txt", "k.txt"], [["K.txt", "k.txt", "K.txt"]]],
    [["İ.txt", "i\u0307.txt"], [["i\u0307.txt", "İ.txt"]]],
    [["I.txt", "ı.txt", "Ａ.txt", "A.txt"], []],
  ]) {
    assert.deepEqual(await groups(paths), expected);
  }
});

test("case-only rename provenance does not introduce an absent old spelling into the current inventory", async () => {
  const input = selection(["readme.md"]);
  input.capabilities["git.changes"] = {
    entries: [{ path: "readme.md", oldPath: "README.md", status: "renamed" }],
  };
  assert.deepEqual(await check.check({ selection: input }), { findings: [] });
  assert.deepEqual(
    await groups([{ path: ".", metadata: { kind: "directory" } }]),
    [],
  );
});

test("both checks reject missing or malformed inventories explicitly", async () => {
  for (const plugin of [check, casing]) {
    await assert.rejects(plugin.check({ selection: null }), /fs.inventory/);
    for (const inventory of [
      null,
      {},
      [null],
      [{ path: "a" }],
      [{ path: "a", metadata: { kind: "unknown" } }],
      ...["", "/absolute", "a//b", "a/../b", "./a", "a/", "\ud800"].map(
        (path) => [{ path, metadata: { kind: "file" } }],
      ),
      [
        { path: "a", metadata: { kind: "file" } },
        { path: "a/b", metadata: { kind: "file" } },
      ],
    ]) {
      await assert.rejects(
        plugin.check({
          selection: { capabilities: { "fs.inventory": inventory } },
        }),
        /fs.inventory/,
      );
    }
  }
  for (const options of [
    null,
    [],
    false,
    { case: "lower" },
    { exceptions: [] },
  ]) {
    assert.throws(
      () => check.validateOptions(options),
      /does not accept options/,
    );
  }
});
