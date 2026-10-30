const kinds = new Set([
  "file",
  "directory",
  "symlink",
  "submodule",
  "untracked",
  "special",
]);

export function pathInventory(selection) {
  const inventory = selection?.capabilities?.["fs.inventory"];
  if (!Array.isArray(inventory)) {
    throw new Error("Path checks require an fs.inventory array.");
  }
  const entries = new Map();
  function add(path, kind) {
    const previous = entries.get(path);
    if (previous && previous.kind !== kind) {
      throw new Error(
        "fs.inventory cannot describe the same path as both a file and directory.",
      );
    }
    entries.set(path, { path, kind });
  }
  for (const entry of inventory) {
    const path = entry?.path;
    const kind = entry?.metadata?.kind;
    if (
      typeof path !== "string" ||
      !path.length ||
      !path.isWellFormed() ||
      !kinds.has(kind)
    ) {
      throw new Error(
        "fs.inventory entries require well-formed paths and supported metadata.kind values.",
      );
    }
    if (path === "." && kind === "directory") continue;
    const components = path.split("/");
    if (
      components.some((part) => !part.length || part === "." || part === "..")
    ) {
      throw new Error(
        "fs.inventory paths must be relative POSIX paths without empty, dot, or parent components.",
      );
    }
    for (let count = 1; count < components.length; count++) {
      add(components.slice(0, count).join("/"), "directory");
    }
    add(path, ["directory", "submodule"].includes(kind) ? "directory" : "file");
  }
  return [...entries.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
