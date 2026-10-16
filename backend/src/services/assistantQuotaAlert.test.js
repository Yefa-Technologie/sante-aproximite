import test from "node:test";
import assert from "node:assert/strict";
import { createQuotaReporter } from "./assistantQuotaAlert.js";

test("quota incidents are durable and the administrator receives only operational metadata", async () => {
  const queries = []; const emails = [];
  const report = createQuotaReporter({
    now: () => new Date("2026-10-16T10:15:00Z"),
    query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ id: 7 }], rowCount: 1 }; },
    sendEmail: async (mail) => emails.push(mail)
  });
  await report({ route: "/speech", model: "tts-model" });
  assert.equal(queries[0].params[0], "tts-model:2026-10-16T10");
  assert.ok(queries[0].sql.includes("ON CONFLICT"));
  assert.equal(emails.length, 1);
  assert.deepEqual(Object.keys(emails[0].metadata), ["model", "route", "date"]);
  assert.match(queries[2].sql, /notified_at = NOW/);
});

test("concurrent or repeated incidents do not send repeated emails", async () => {
  let calls = 0; let mails = 0;
  const report = createQuotaReporter({ query: async () => ++calls === 1 ? { rows: [{ id: 7 }], rowCount: 1 } : { rows: [], rowCount: 0 }, sendEmail: async () => { mails++; } });
  await report({ route: "/chat", model: "chat-model" });
  assert.equal(mails, 0);
});

test("SMTP failure leaves the incident unnotified for a later retry", async () => {
  let queries = 0; let logged = 0;
  const report = createQuotaReporter({ query: async () => { queries++; return { rows: [{ id: 7 }], rowCount: 1 }; }, sendEmail: async () => { throw new Error("SMTP_FAILED"); }, logger: { error: () => { logged++; } } });
  await report({ route: "/chat", model: "chat-model" });
  assert.equal(queries, 2);
  assert.equal(logged, 1);
});
