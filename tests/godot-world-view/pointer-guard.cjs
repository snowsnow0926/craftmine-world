// No-input guard for the Godot world acceptance run (project AGENTS.md).
// Counts pointer-lock and window-focus attempts and refuses the former.
const { ipcRenderer } = require("electron");

const report = (kind) => {
  try {
    ipcRenderer.send("pi-desktop/godot-world/guard", kind);
  } catch {
    // The main process may already be gone.
  }
};

if (typeof Element !== "undefined") {
  Element.prototype.requestPointerLock = function requestPointerLock() {
    report("pointer-lock");
    return Promise.reject(new Error("Pointer lock disabled for automated acceptance"));
  };
}
if (typeof window !== "undefined") {
  window.focus = () => report("window-focus");
}
