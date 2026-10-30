import net from "node:net";

net.Socket.prototype.connect = function () {
  throw new Error("Unexpected runtime networking.");
};
globalThis.fetch = () => {
  throw new Error("Unexpected runtime fetch.");
};
