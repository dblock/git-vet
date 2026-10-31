import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import check from "svet-check-file-eol";
import indexedCheck from "svet-check-git-index-eol";
import selector from "svet-files-glob";

test("file EOL checks captured bytes after working files change, reporting the first offending line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "svet file EOL "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "captured.txt");
  await writeFile(path, "first\nsecond\r\nthird");
  const selection = await selector.select({
    root,
    options: { pattern: "*.txt" },
    input: null,
  });
  await writeFile(path, "clean replacement");
  const result = await check.check({
    selection,
    candidate: selection.candidates[0],
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, "captured.txt");
  assert.deepEqual(result.findings[0].location, { line: 2 });
  assert.equal(await readFile(path, "utf8"), "clean replacement");
});

test("file EOL distinguishes binary skips from invalid providers and snapshot failures", async () => {
  const candidate = {
    path: "file.txt",
    async read() {
      throw new Error("Snapshot unavailable.");
    },
  };
  const capabilities = {
    "content.snapshot": true,
    "content.text": { isText: () => true },
  };
  const invoke = () => check.check({ candidate, selection: { capabilities } });
  await assert.rejects(invoke, /Snapshot unavailable/);
  candidate.read = async () => "not bytes";
  await assert.rejects(invoke, /Uint8Array/);
  candidate.read = async () => new Uint8Array();
  capabilities["content.text"].isText = () => undefined;
  await assert.rejects(invoke, /boolean/);
  capabilities["content.text"].isText = () => false;
  assert.deepEqual(await invoke(), {
    skip: "The selected content snapshot is binary.",
  });
  capabilities["content.text"].isText = () => true;
  assert.deepEqual(await invoke(), { findings: [] });
  capabilities["content.snapshot"] = false;
  await assert.rejects(invoke, /requires captured/);
  capabilities["content.snapshot"] = true;
  candidate.read = undefined;
  await assert.rejects(invoke, /requires captured/);
  candidate.read = async () => new Uint8Array();
  capabilities["content.text"] = {};
  await assert.rejects(invoke, /requires captured/);
  assert.throws(
    () => check.validateOptions({ fix: true }),
    /Unknown file EOL check option/,
  );
});

test("both EOL checks accept only the configured ending and count CRLF or CR as one line", async () => {
  const endings = [
    { eol: "lf", bytes: "\n", label: "LF" },
    { eol: "cr", bytes: "\r", label: "CR" },
    { eol: "crlf", bytes: "\r\n", label: "CRLF" },
    { eol: "cr-lf", bytes: "\r\n", label: "CRLF" },
  ];
  for (const plugin of [check, indexedCheck]) {
    for (const ending of [{ ...endings[0], eol: undefined }, ...endings]) {
      const options = ending.eol === undefined ? {} : { eol: ending.eol };
      plugin.validateOptions(options);
      const invoke = async (content) => {
        const bytes = new TextEncoder().encode(content);
        const candidate = {
          path: "file.txt",
          read: async () => {
            assert.equal(
              plugin,
              check,
              "Index checks must not read candidates.",
            );
            return bytes;
          },
        };
        return plugin.check({
          options,
          candidate,
          selection: {
            capabilities: {
              "content.snapshot": true,
              "content.text": { isText: () => true },
              "git.index": {
                entries: [{ path: candidate.path, mode: "100644", stage: 0 }],
                read: async () => {
                  assert.equal(
                    plugin,
                    indexedCheck,
                    "File checks must not read the index.",
                  );
                  return bytes;
                },
              },
            },
          },
        });
      };
      for (const content of [
        "",
        "no ending",
        `first${ending.bytes}second${ending.bytes}`,
        `first${ending.bytes}no final ending`,
      ]) {
        assert.deepEqual(await invoke(content), { findings: [] });
      }
      for (const actual of endings.slice(0, 3)) {
        if (actual.label === ending.label) continue;
        const result = await invoke(
          `first${ending.bytes}second${ending.bytes}third${actual.bytes}fourth`,
        );
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].ruleId, "eol");
        assert.equal(result.findings[0].path, "file.txt");
        assert.deepEqual(result.findings[0].location, { line: 3 });
        assert.match(
          result.findings[0].message,
          new RegExp(
            `contains ${actual.label} line endings; expected ${ending.label}\\.`,
          ),
        );
      }
    }
    for (const eol of ["", "mixed", "auto", "LF", null, 13, true, [], {}]) {
      assert.throws(() => plugin.validateOptions({ eol }), /eol must be/);
    }
    assert.throws(
      () => plugin.validateOptions({ eol: "crlf", fix: true }),
      /Unknown .* EOL check option/,
    );
  }
});
