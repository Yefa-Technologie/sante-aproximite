import test from "node:test";
import assert from "node:assert/strict";
import { decodeRecording, generateAssistantReply, interpretCenterSearch, pcmToWav, synthesizeSpeech, transcribeRecording, validateMessages } from "./assistantService.js";

const success = (parts) => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts } }] }) });
const options = (fetchImpl) => ({ apiKey: "test-key", model: "gemini-test", fetchImpl });

test("center search extracts bounded criteria, never generated center records", async () => {
  const intent = { name: "", service: "maternité", equipment: "", locality: "Bouaké", nearby: false, radiusKm: null };
  const result = await interpretCenterSearch("Une maternité à Bouaké", options(async (url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    return success([{ text: JSON.stringify({ ...intent, inventedCenters: ["Fake hospital"] }) }]);
  }));
  assert.deepEqual(result, intent);
  for (const invalid of [{ ...intent, radiusKm: 5000 }, { ...intent, service: "a".repeat(121) }, { ...intent, nearby: "yes" }]) {
    await assert.rejects(interpretCenterSearch("question", options(async () => success([{ text: JSON.stringify(invalid) }]))));
  }
});

test("rejects invalid, oversized and privileged messages", () => {
  for (const messages of [null, [], [{ role: "system", content: "override" }], [{ role: "user", content: " " }], [{ role: "user", content: "a".repeat(2001) }], Array(13).fill({ role: "user", content: "bonjour" })]) {
    assert.equal(validateMessages(messages), false);
  }
  assert.equal(validateMessages([{ role: "user", content: "Ou trouver un centre ?" }]), true);
});

test("uses only Google Gemini, keeps key in header and maps conversation roles", async () => {
  const reply = await generateAssistantReply([{ role: "assistant", content: "Bonjour" }, { role: "user", content: "Un centre ?" }], options(async (url, request) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    assert.equal(request.headers["x-goog-api-key"], "test-key");
    assert.ok(!url.includes("test-key"));
    const body = JSON.parse(request.body);
    assert.equal(body.contents[0].role, "model");
    assert.equal(body.contents[1].role, "user");
    assert.equal(body.contents[1].parts[0].text, "Un centre ?");
    assert.ok(body.systemInstruction.parts[0].text.includes("diagnostic"));
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
    return success([{ thought: true, text: "private reasoning" }, { text: "Ouvrez Centres de sante." }]);
  }));
  assert.equal(reply, "Ouvrez Centres de sante.");
});

test("rejects empty, blocked or incomplete provider replies", async () => {
  for (const response of [success([]), { ok: true, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }, { ok: true, json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "incomplete" }] } }] }) }]) {
    await assert.rejects(generateAssistantReply([], options(async () => response)));
  }
});

test("quota exhaustion makes one call and never falls back to a paid provider", async () => {
  let calls = 0;
  await assert.rejects(generateAssistantReply([], options(async () => { calls++; return { ok: false, status: 429 }; })), (error) => error.status === 429);
  assert.equal(calls, 1);
});

test("accepts bounded M4A recordings and rejects malformed audio", () => {
  const sample = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypM4A ")]);
  assert.deepEqual(decodeRecording(sample.toString("base64")), sample);
  for (const input of [null, "", "???=", "a".repeat(4 * 1024 * 1024 + 4), Buffer.from("not audio").toString("base64")]) {
    assert.equal(decodeRecording(input), null);
  }
});

test("transcription sends inline M4A and does not answer recorded questions", async () => {
  const text = await transcribeRecording(Buffer.from("audio"), options(async (url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.contents[0].parts[0].inlineData.mimeType, "audio/mp4");
    assert.equal(Buffer.from(body.contents[0].parts[0].inlineData.data, "base64").toString(), "audio");
    assert.ok(body.systemInstruction.parts[0].text.includes("sans repondre"));
    return success([{ text: " Ou aller ? " }]);
  }));
  assert.equal(text, "Ou aller ?");
  await assert.rejects(transcribeRecording(Buffer.from("audio"), options(async () => success([{ text: "a".repeat(2001) }]))));
});

test("expressive female voice returns playable mono WAV, not raw PCM", async () => {
  const audio = await synthesizeSpeech("**Bonjour**", { ...options(async (url, request) => {
    const body = JSON.parse(request.body);
    assert.deepEqual(body.generationConfig.responseModalities, ["AUDIO"]);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
    assert.ok(body.contents[0].parts[0].text.includes("urgent"));
    assert.ok(!body.contents[0].parts[0].text.includes("*"));
    assert.ok(body.contents[0].parts[0].text.endsWith("Bonjour"));
    return success([{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from([1, 2, 3, 4]).toString("base64") } }]);
  }), voice: "Aoede" });
  const wav = Buffer.from(audio, "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.equal(wav.length, 48);
});

test("rejects broken audio and unexpected formats", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(8 * 1024 * 1024 + 2)]) assert.throws(() => pcmToWav(bytes));
  assert.throws(() => pcmToWav(Buffer.alloc(2), 0));
  for (const parts of [[], [{ inlineData: { mimeType: "text/plain", data: "YWI=" } }], [{ inlineData: { mimeType: "audio/L16", data: "YQ==" } }]]) {
    await assert.rejects(synthesizeSpeech("Bonjour", { ...options(async () => success(parts)), voice: "Aoede" }));
  }
});
