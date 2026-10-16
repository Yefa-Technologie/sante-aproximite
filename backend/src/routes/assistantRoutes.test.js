import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAssistantRouter, ASSISTANT_UNAVAILABLE, ASSISTANT_ERROR } from "./assistantRoutes.js";

async function setup(t, overrides = {}) {
  const app = express(); app.use(express.json());
  app.use("/assistant", createAssistantRouter({
    auth: (req, res, next) => { req.user = { id: req.headers["x-user-id"] || "1", role: req.headers["x-role"] || "USER" }; next(); },
    authorize: (roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
    config: { geminiApiKey: "test", geminiModel: "chat-test", geminiTranscriptionModel: "transcribe-test", geminiSpeechModel: "speech-test", geminiSpeechVoice: "Aoede" },
    reply: async () => "Bonjour !", search: async () => ({ service: "maternité" }), transcribe: async () => "Bonjour", speech: async () => "audio",
    reportQuota: async () => {}, query: async () => ({ rows: [{ id: 7, occurrence_count: 2 }] }), ...overrides
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return (path, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/assistant${path}`, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test("every mobile role receives generic unavailability while provider quotas alert the administrator", async (t) => {
  const alerts = [];
  const fail = async () => { throw Object.assign(new Error("private provider quota details"), { status: 429 }); };
  const request = await setup(t, { reply: fail, speech: fail, transcribe: fail, reportQuota: async (alert) => alerts.push(alert) });
  const audio = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypM4A ")]).toString("base64");
  for (const role of ["USER", "CHEF_ETABLISSEMENT", "DEVELOPER"]) {
    for (const [path, body] of [["/chat", { messages: [{ role: "user", content: "Bonjour" }] }], ["/speech", { text: "Bonjour" }], ["/transcribe", { audio }]]) {
      const response = await request(path, body, { "x-role": role });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { message: ASSISTANT_UNAVAILABLE, code: "ASSISTANT_UNAVAILABLE" });
    }
  }
  assert.equal(alerts.length, 9);
  assert.deepEqual(alerts[0], { route: "/chat", model: "chat-test" });
});

test("assisted center searches use the same quota alerts and generic mobile errors", async (t) => {
  let alert;
  const request = await setup(t, { search: async () => { throw Object.assign(new Error("quota"), { status: 429 }); }, reportQuota: async (value) => { alert = value; } });
  assert.equal((await request("/center-search", { question: "" })).status, 400);
  const response = await request("/center-search", { question: "Une maternité près de moi" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).message, ASSISTANT_UNAVAILABLE);
  assert.deepEqual(alert, { route: "/center-search", model: "chat-test" });
});

test("configuration errors are not exposed and ordinary service errors do not report quotas", async (t) => {
  const unconfigured = await setup(t, { config: {} });
  assert.equal((await (await unconfigured("/chat", { messages: [] })).json()).message, ASSISTANT_ERROR);
  let alerts = 0;
  const unavailable = await setup(t, { reply: async () => { throw new Error("internal failure"); }, reportQuota: async () => { alerts++; } });
  assert.equal((await (await unavailable("/chat", { messages: [{ role: "user", content: "Bonjour" }] })).json()).message, ASSISTANT_ERROR);
  assert.equal(alerts, 0);
});

test("a technical speech failure is not labeled as a quota or an unavailable assistant", async (t) => {
  let alerts = 0;
  const request = await setup(t, { speech: async () => { throw new Error("SPEECH_UNSUPPORTED_FORMAT"); }, reportQuota: async () => { alerts++; } });
  const response = await request("/speech", { text: "Bonjour" });
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.code, "VOICE_UNAVAILABLE");
  assert.notEqual(data.message, ASSISTANT_UNAVAILABLE);
  assert.equal(alerts, 0);
});

test("admin incidents are protected and local throttling does not send quota emails", async (t) => {
  let alerts = 0;
  const request = await setup(t, { reportQuota: async () => { alerts++; } });
  assert.equal((await request("/admin/alerts")).status, 403);
  assert.equal((await request("/admin/alerts", null, { "x-role": "DEVELOPER" })).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await request("/chat", { messages: [{ role: "user", content: "Bonjour" }] })).status, 200);
  const response = await request("/chat", { messages: [{ role: "user", content: "Bonjour" }] });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).message, ASSISTANT_UNAVAILABLE);
  assert.equal(alerts, 0);
});
