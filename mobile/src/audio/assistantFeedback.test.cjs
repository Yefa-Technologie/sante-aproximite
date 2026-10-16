const test = require("node:test");
const assert = require("node:assert/strict");
const { OFFLINE_MESSAGE, UNAVAILABLE_MESSAGE, SERVICE_ERROR_MESSAGE, VOICE_ERROR_MESSAGE, isOffline, feedbackForFailure, buildAssistantHistory } = require("./assistantFeedback.cjs");

test("offline message is explicit, while unknown network state is not called offline", () => {
  assert.equal(isOffline({ isConnected: null, isInternetReachable: null }), false);
  assert.equal(feedbackForFailure({}, { isConnected: false }), OFFLINE_MESSAGE);
  assert.equal(feedbackForFailure({}, { isConnected: true, isInternetReachable: false }), OFFLINE_MESSAGE);
  assert.equal(feedbackForFailure({ code: "ASSISTANT_OFFLINE" }), OFFLINE_MESSAGE);
});

test("quota unavailability is distinct from technical and voice errors without exposing internals", () => {
  assert.equal(feedbackForFailure({ status: 429 }), UNAVAILABLE_MESSAGE);
  assert.equal(feedbackForFailure({ status: 503, code: "ASSISTANT_UNAVAILABLE" }), UNAVAILABLE_MESSAGE);
  for (const status of [500, 502, 503]) assert.equal(feedbackForFailure({ status, message: "private provider details" }), SERVICE_ERROR_MESSAGE);
  assert.equal(feedbackForFailure({ code: "VOICE_UNAVAILABLE" }), VOICE_ERROR_MESSAGE);
  assert.equal(feedbackForFailure({ code: "UPSTREAM_TIMEOUT" }, { isConnected: true }), SERVICE_ERROR_MESSAGE);
});

test("operational feedback never enters model history and long replies fit request limits", () => {
  const history = buildAssistantHistory([{ role: "assistant", content: OFFLINE_MESSAGE, notice: true }, { role: "assistant", content: "a".repeat(3500) }], "Bonjour");
  assert.equal(history.length, 2);
  assert.equal(history[0].content.length, 2000);
  assert.deepEqual(history[1], { role: "user", content: "Bonjour" });
  assert.equal(buildAssistantHistory(Array(20).fill({ role: "user", content: "question" }), "suite").length, 12);
});
