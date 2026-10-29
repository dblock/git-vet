export class Error extends globalThis.Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

export function invariant(condition, code, message) {
  if (!condition) {
    throw new Error(code, message);
  }
}
