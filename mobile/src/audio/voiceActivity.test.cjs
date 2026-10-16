const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoiceActivity, sampleVoiceActivity } = require("./voiceActivity.cjs");

test("silence never triggers an upload", () => {
  const state = createVoiceActivity(0);
  for (let t = 200; t < 12000; t += 200) assert.equal(sampleVoiceActivity(state, -65, t), "listening");
  assert.equal(sampleVoiceActivity(state, -65, 12000), "silence");
});

test("ends a spoken phrase after a natural pause, preserving short pauses", () => {
  const state = createVoiceActivity(0);
  sampleVoiceActivity(state, -28, 200);
  assert.equal(sampleVoiceActivity(state, -28, 400), "speaking");
  assert.equal(sampleVoiceActivity(state, -65, 1200), "speaking");
  assert.equal(sampleVoiceActivity(state, -28, 1400), "speaking");
  assert.equal(sampleVoiceActivity(state, -65, 2800), "speaking");
  assert.equal(sampleVoiceActivity(state, -65, 3000), "finished");
});

test("an isolated noise does not count as a question", () => {
  const state = createVoiceActivity(0);
  sampleVoiceActivity(state, -10, 200);
  for (let t = 400; t < 12000; t += 200) assert.equal(sampleVoiceActivity(state, -65, t), "listening");
  assert.equal(sampleVoiceActivity(state, -65, 12000), "silence");
});

test("missing metering stops instead of uploading empty recordings", () => {
  const state = createVoiceActivity(0);
  assert.equal(sampleVoiceActivity(state, undefined, 1000), "listening");
  assert.equal(sampleVoiceActivity(state, undefined, 12000), "no-meter");
});
