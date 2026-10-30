import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import check from "@svet/check-file-lf";
import selector from "@svet/files-glob";

test("file LF checks captured bytes after working files change, reporting the first offending line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "svet file LF "));
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

test("file LF distinguishes binary skips from invalid providers and snapshot failures", async () => {
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
    /Unknown file LF check option/,
  );
});
