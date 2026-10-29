export class GitVetError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "GitVetError";
    this.code = code;
  }
}

export function invariant(condition, code, message) {
  if (!condition) {
    throw new GitVetError(code, message);
  }
}
