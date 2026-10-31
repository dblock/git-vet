import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import check from "svet-check-file-trailing-whitespace";
import selector from "svet-files-glob";

async function inspect(content, options = {}) {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return check.check({
    options,
    candidate: { path: "file.txt", read: async () => bytes },
    selection: {
      capabilities: {
        "content.snapshot": true,
        "content.text": { isText: () => true },
      },
    },
  });
}

test("trailing-whitespace checks captured contents without changing a replacement file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "svet trailing whitespace "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "captured.txt");
  await writeFile(path, "first\r\nsecond \t\rthird\n");
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
  assert.equal(result.findings[0].ruleId, "trailing-whitespace");
  assert.equal(result.findings[0].path, "captured.txt");
  assert.deepEqual(result.findings[0].location, { line: 2 });
  assert.equal(await readFile(path, "utf8"), "clean replacement");
});

test("trailing-whitespace handles all line boundaries, EOF, and configurable literal characters", async () => {
  for (const content of [
    "",
    "no ending",
    "  indentation\ninside\ta line\r\n\r",
  ]) {
    assert.deepEqual(await inspect(content), { findings: [] });
  }
  for (const ending of ["\n", "\r", "\r\n", ""]) {
    for (const suffix of [" ", "\t", " \t", "\t "]) {
      const result = await inspect(`first\r\nsecond\rthird${suffix}${ending}`);
      assert.equal(result.findings.length, 1);
      assert.deepEqual(result.findings[0].location, { line: 3 });
    }
  }
  assert.deepEqual((await inspect(" \t\n")).findings[0].location, { line: 1 });
  for (const character of ["x", "\u00a0", "\u{1f600}", "\u0301"]) {
    const options = { whitespace: [character] };
    assert.equal(
      (await inspect(`text${character}\n`, options)).findings.length,
      1,
    );
    assert.deepEqual(await inspect(`inside${character}text \t\n`, options), {
      findings: [],
    });
  }
  for (const whitespace of [
    ["space"],
    [" "],
    ["space", " "],
    ["tab"],
    ["\t"],
  ]) {
    const character =
      whitespace[0] === "tab" || whitespace[0] === "\t" ? "\t" : " ";
    const other = character === " " ? "\t" : " ";
    assert.equal(
      (await inspect(`text${character}`, { whitespace })).findings.length,
      1,
    );
    assert.deepEqual(await inspect(`text${other}`, { whitespace }), {
      findings: [],
    });
  }
  assert.equal(
    (await inspect(new Uint8Array([0xff, 32, 10]))).findings.length,
    1,
  );
  assert.deepEqual(
    await inspect(new Uint8Array([0xff, 0xa0, 10]), { whitespace: ["\u00a0"] }),
    { findings: [] },
  );
  assert.equal(
    (
      await inspect(new Uint8Array([0xff, 0xc2, 0xa0, 10]), {
        whitespace: ["\u00a0"],
      })
    ).findings.length,
    1,
  );
});

test("trailing-whitespace rejects invalid options and providers and explicitly skips binary snapshots", async () => {
  for (const whitespace of [
    null,
    "space",
    [],
    [null],
    [1],
    [""],
    ["two"],
    ["\r"],
    ["\n"],
    ["\r\n"],
    ["\ud800"],
    ["\udfff"],
    ["e\u0301"],
  ]) {
    assert.throws(() => check.validateOptions({ whitespace }), /whitespace/);
  }
  assert.throws(
    () => check.validateOptions({ fix: true }),
    /Unknown .* option/,
  );
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
  candidate.read = async () => new Uint8Array([0, 32]);
  capabilities["content.text"].isText = () => undefined;
  await assert.rejects(invoke, /boolean/);
  capabilities["content.text"].isText = () => false;
  assert.deepEqual(await invoke(), {
    skip: "The selected content snapshot is binary.",
  });
  capabilities["content.text"].isText = () => true;
  capabilities["content.snapshot"] = false;
  await assert.rejects(invoke, /requires captured/);
  capabilities["content.snapshot"] = true;
  candidate.read = undefined;
  await assert.rejects(invoke, /requires captured/);
  candidate.read = async () => new Uint8Array();
  capabilities["content.text"] = {};
  await assert.rejects(invoke, /requires captured/);
});
