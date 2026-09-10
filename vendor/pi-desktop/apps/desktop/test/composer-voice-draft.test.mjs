import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { appendVoiceTranscript } = await import("../src/lib/composer-voice-draft.ts");

test("recognition appends to the current draft without dropping attachments or whitespace", () => {
  assert.equal(appendVoiceTranscript("", "  Add a tree  "), "Add a tree");
  assert.equal(appendVoiceTranscript("Existing wish", "Add a tree"), "Existing wish\nAdd a tree");
  assert.equal(appendVoiceTranscript("Existing wish\n", "Add a tree"), "Existing wish\nAdd a tree");
  assert.equal(appendVoiceTranscript("Image \uE000 ", "Add a tree"), "Image \uE000 Add a tree");
  assert.equal(appendVoiceTranscript("保留草稿", "  增加一棵树  "), "保留草稿\n增加一棵树");
});

test("empty recognition never erases or changes the draft", () => {
  assert.equal(appendVoiceTranscript("Keep this draft\n", " \n"), "Keep this draft\n");
});
