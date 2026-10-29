import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateCheckResult,
  validatePlugin,
  validateSelection,
} from "../src/index.mjs";

const check = {
  apiVersion: 1,
  kind: "check",
  id: "example/check",
  scope: "file",
  rules: ["spelling"],
  requires: ["content.snapshot"],
  async check() {
    return { findings: [] };
  },
};

test("versioned asynchronous selectors and checks share the public contract", () => {
  assert.equal(validatePlugin(check, "check"), check);
  const selector = {
    apiVersion: 1,
    kind: "selector",
    id: "example/timestamp",
    async select() {
      return { candidates: [], capabilities: {} };
    },
  };
  assert.equal(validatePlugin(selector, "selector"), selector);
  for (const plugin of [
    { ...check, apiVersion: 2 },
    { ...check, id: "Unstable Name" },
    { ...check, kind: "selector" },
    { ...check, rules: ["spelling", "spelling"] },
    { ...check, requires: ["git.index", "git.index"] },
    { ...check, check: undefined },
    { ...check, scope: "global" },
    { ...check, validateOptions: {} },
  ]) {
    assert.throws(() => validatePlugin(plugin, "check"), {
      code: "INVALID_CONTRACT",
    });
  }
});

test("non-Git candidates preserve optional content snapshots and opaque capabilities", () => {
  const candidate = {
    id: "snapshot/file",
    path: "spaces and \u03bb.txt",
    snapshot: { kind: "memory", id: "version-1" },
    metadata: { modifiedAt: 123 },
    async read() {
      return new Uint8Array([10]);
    },
  };
  const selection = {
    candidates: [candidate],
    capabilities: { "fs.timestamps": true, "fs.inventory": [candidate] },
    context: { scope: "recent", count: 1 },
    decisions: [
      { state: "filtered", path: "older.txt", reason: "Before the cutoff." },
    ],
  };
  assert.equal(validateSelection(selection), selection);
  assert.equal(selection.candidates[0], candidate);
  assert.equal(
    validateSelection({
      candidates: [{ id: "unavailable", path: "deleted.txt" }],
      capabilities: {},
    }).candidates[0].read,
    undefined,
  );
  const cycle = {};
  cycle.self = cycle;
  for (const invalid of [
    { ...selection, candidates: [candidate, candidate] },
    { ...selection, capabilities: { "git.index": undefined } },
    { ...selection, context: cycle },
    { ...selection, context: { reader: candidate.read } },
    { ...selection, candidates: [{ id: "a", path: "" }] },
    { ...selection, candidates: [{ ...candidate, snapshot: {} }] },
    { ...selection, decisions: [{ state: "passed", reason: "Not a state." }] },
  ]) {
    assert.throws(() => validateSelection(invalid), {
      code: "INVALID_CONTRACT",
    });
  }
});

test("checks return declared findings or an explicit whole-invocation skip", () => {
  const finding = {
    ruleId: "spelling",
    message: "Unknown word.",
    path: "a.txt",
    location: { line: 2, column: 3 },
  };
  validateCheckResult({ findings: [finding] }, check);
  validateCheckResult(
    {
      findings: [
        { ruleId: "spelling", message: "Project-level finding." },
        { ruleId: "spelling", message: "Group.", paths: ["a", "b"] },
      ],
    },
    check,
  );
  validateCheckResult({ skip: "Binary content." }, check);
  for (const result of [
    undefined,
    {},
    { skip: "" },
    { skip: "Binary", findings: [] },
    { findings: [{ ...finding, ruleId: "undeclared" }] },
    { findings: [{ ...finding, severity: "info" }] },
    { findings: [{ ...finding, location: { line: 0 } }] },
    { findings: [{ ...finding, path: undefined }] },
  ]) {
    assert.throws(() => validateCheckResult(result, check), {
      code: "INVALID_CONTRACT",
    });
  }
});
