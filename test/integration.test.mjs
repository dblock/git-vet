import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createConsumer } from "../fixtures/integration.mjs";

function normalizePaths(value, project) {
  if (typeof value === "string") {
    if (value.startsWith(`${project}${sep}`)) {
      return `<project>/${value
        .slice(project.length + 1)
        .split(sep)
        .join("/")}`;
    }
    return value.replaceAll(project, "<project>");
  }
  if (Array.isArray(value))
    return value.map((item) => normalizePaths(item, project));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizePaths(item, project),
      ]),
    );
  }
  return value;
}

test("installed CLI acceptance fixtures", async (t) => {
  const consumer = await createConsumer(t);
  const root = fileURLToPath(
    new URL("../fixtures/integration/", import.meta.url),
  );
  const fixtures = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(fixtures.includes("basics"));
  for (const name of fixtures) {
    await t.test(name, async (t) => {
      const directory = join(root, name);
      const definition = JSON.parse(
        await readFile(join(directory, "command.json"), "utf8"),
      );
      const result = await consumer.run(t, directory, definition);
      const expectedCode = await readFile(
        join(directory, "expected.exit-code"),
        "utf8",
      );
      assert.match(expectedCode, /^[012]\n$/u);
      assert.equal(result.status, Number(expectedCode), result.stderr);
      const expectedOut = await readFile(
        join(directory, "expected.stdout"),
        "utf8",
      );
      if (expectedOut.trimStart().startsWith("{")) {
        assert.deepEqual(
          normalizePaths(JSON.parse(result.stdout), result.project),
          JSON.parse(expectedOut),
        );
      } else {
        assert.equal(
          normalizePaths(result.stdout, result.project),
          expectedOut,
        );
      }
      assert.equal(
        normalizePaths(result.stderr, result.project),
        await readFile(join(directory, "expected.stderr"), "utf8"),
      );
    });
  }
});
