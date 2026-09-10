import assert from "node:assert/strict";
import test from "node:test";
import { VoiceMicrophonePermissionGate } from "../electron/main/voice-microphone-permission.ts";

function fixture() {
  let time = 0;
  let trusted = { ownerId: 7, documentUrl: "file:///app/index.html" };
  const gate = new VoiceMicrophonePermissionGate(() => trusted, () => time);
  const input = { requestId: "gesture-1", contextKey: "session/world" };
  const details = { isMainFrame: true, requestingUrl: trusted.documentUrl, mediaTypes: ["audio"] };
  return { gate, input, details, arm: () => gate.arm(7, trusted.documentUrl, true, input), expire: () => { time = 10_000; }, navigate: () => { trusted = { ...trusted, documentUrl: "file:///another.html" }; } };
}
test("one valid arm permits only one actual audio request, never a standing permission", () => {
  const f = fixture(); assert.equal(f.gate.check(), false); assert.equal(f.gate.request(7, "media", f.details), false);
  assert.equal(f.arm(), true); assert.equal(f.gate.check(), false);
  assert.equal(f.gate.request(7, "media", f.details), true); assert.equal(f.gate.request(7, "media", f.details), false);
});
test("arm validates owner, exact document, main frame, and bounded identity", () => {
  const f = fixture();
  for (const args of [[8, "file:///app/index.html", true, f.input], [7, "file:///plugin/index.html", true, f.input], [7, "file:///app/index.html#other", true, f.input], [7, "file:///app/index.html", false, f.input], [7, "file:///app/index.html", true, {}], [7, "file:///app/index.html", true, { ...f.input, contextKey: "x".repeat(4097) }]]) assert.equal(f.gate.arm(...args), false);
});
test("world/plugin frames, video, display capture, missing or mixed media types cannot consume arm", () => {
  const f = fixture(); f.arm();
  for (const [id, permission, details] of [[8, "media", f.details], [7, "display-capture", f.details], [7, "media", { ...f.details, isMainFrame: false }], [7, "media", { ...f.details, requestingUrl: "file:///plugin.html" }], [7, "media", { ...f.details, mediaTypes: ["video"] }], [7, "media", { ...f.details, mediaTypes: ["audio", "video"] }], [7, "media", { ...f.details, mediaTypes: [] }], [7, "media", {}]]) assert.equal(f.gate.request(id, permission, details), false);
  assert.equal(f.gate.request(7, "media", f.details), true);
});
test("expiry, navigation, cancellation, blur/destroy disposal revoke unused microphone grant", () => {
  for (const invalidate of [f => f.expire(), f => f.navigate(), f => f.gate.cancel(7), f => f.gate.cancel(7, "gesture-1"), f => f.gate.dispose()]) {
    const f = fixture(); f.arm(); invalidate(f); assert.equal(f.gate.request(7, "media", f.details), false);
  }
  const f = fixture(); f.arm(); f.gate.cancel(8); f.gate.cancel(7, "other-gesture"); assert.equal(f.gate.request(7, "media", f.details), true);
});
