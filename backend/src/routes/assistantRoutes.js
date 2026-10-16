import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import { env } from "../config/env.js";
import { pool } from "../config/db.js";
import { sendMailToYefa } from "../services/mailService.js";
import { createQuotaReporter } from "../services/assistantQuotaAlert.js";
import { decodeRecording, generateAssistantReply, interpretCenterSearch, synthesizeSpeech, transcribeRecording, validateMessages } from "../services/assistantService.js";

export const ASSISTANT_UNAVAILABLE = "Assistant IA indisponible, veuillez réessayer plus tard.";
export const ASSISTANT_ERROR = "Une erreur est survenue pendant le traitement de votre demande. Veuillez réessayer.";
const quotaReporter = createQuotaReporter({ query: (...args) => pool.query(...args), sendEmail: sendMailToYefa });

export function createAssistantRouter({ auth = requireAuth, authorize = requireRole, config = env,
  reply = generateAssistantReply, search = interpretCenterSearch, transcribe = transcribeRecording, speech = synthesizeSpeech,
  reportQuota = quotaReporter, query = (...args) => pool.query(...args) } = {}) {
  const router = Router();
  const usage = new Map();
  let lastCleanup = 0;
  const modelFor = (path) => path === "/speech" ? config.geminiSpeechModel : path === "/transcribe" ? config.geminiTranscriptionModel : config.geminiModel;
  function unavailable(res, status = 503) { return res.status(status).json({ message: ASSISTANT_UNAVAILABLE, code: "ASSISTANT_UNAVAILABLE" }); }
  function providerFailure(req, res, error) {
    if (error.status === 429) {
      // Report internally; never reveal quota details, including to administrators using the mobile app.
      Promise.resolve().then(() => reportQuota({ route: req.path, model: modelFor(req.path) })).catch(() => {});
      res.set("Retry-After", "60");
      return unavailable(res);
    }
    if (req.path === "/speech") return res.status(502).json({ code: "VOICE_UNAVAILABLE", message: "La lecture vocale a échoué. Votre réponse reste disponible à l’écran." });
    return res.status(502).json({ code: "ASSISTANT_ERROR", message: ASSISTANT_ERROR });
  }

  router.use(auth, (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/admin/alerts", authorize(["DEVELOPER", "NATIONAL", "REGULATOR"]), async (req, res) => {
    try {
      const result = await query(`SELECT id, model, route, first_seen_at, last_seen_at, occurrence_count, notified_at
        FROM assistant_quota_alerts ORDER BY last_seen_at DESC LIMIT 100`);
      res.json({ alerts: result.rows });
    } catch { res.status(503).json({ message: "Les alertes administrateur sont temporairement indisponibles." }); }
  });
  router.use((req, res, next) => {
    if (!config.geminiApiKey) return res.status(503).json({ code: "ASSISTANT_ERROR", message: ASSISTANT_ERROR });
    const now = Date.now();
    if (now - lastCleanup > 60000) {
      for (const [key, entry] of usage) if (entry.until <= now) usage.delete(key);
      lastCleanup = now;
    }
    const key = `${req.user.id}:${req.path}`;
    const entry = usage.get(key);
    if (entry && entry.until > now && entry.count >= 10) {
      res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      return unavailable(res);
    }
    usage.set(key, entry && entry.until > now ? { ...entry, count: entry.count + 1 } : { count: 1, until: now + 60000 });
    next();
  });

  router.post("/chat", async (req, res) => {
    if (!validateMessages(req.body?.messages)) return res.status(400).json({ message: "Envoyez de 1 à 12 messages de 2000 caractères maximum." });
    try {
      const text = await reply(req.body.messages, { apiKey: config.geminiApiKey, model: config.geminiModel });
      res.json({ reply: text });
    } catch (error) { providerFailure(req, res, error); }
  });
  router.post("/center-search", async (req, res) => {
    const question = req.body?.question;
    if (typeof question !== "string" || !question.trim() || question.length > 2000) return res.status(400).json({ message: "Décrivez votre recherche en 2000 caractères maximum." });
    try {
      const intent = await search(question, { apiKey: config.geminiApiKey, model: config.geminiModel });
      res.json({ intent });
    } catch (error) { providerFailure(req, res, error); }
  });
  router.post("/transcribe", async (req, res) => {
    const bytes = decodeRecording(req.body?.audio);
    if (!bytes) return res.status(400).json({ message: "Enregistrement M4A invalide ou trop volumineux (3 Mo maximum)." });
    try {
      const text = await transcribe(bytes, { apiKey: config.geminiApiKey, model: config.geminiTranscriptionModel });
      res.json({ text });
    } catch (error) {
      if (["GEMINI_EMPTY_RESPONSE", "TRANSCRIPTION_TOO_LONG"].includes(error.message)) return res.status(422).json({ code: "NO_SPEECH", message: "Aucune parole exploitable reconnue. Réenregistrez votre question." });
      providerFailure(req, res, error);
    }
  });
  router.post("/speech", async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 3500) return res.status(400).json({ message: "Texte vocal invalide (3500 caractères maximum)." });
    try {
      const audio = await speech(text, { apiKey: config.geminiApiKey, model: config.geminiSpeechModel, voice: config.geminiSpeechVoice });
      res.json({ audio, format: "wav" });
    } catch (error) { providerFailure(req, res, error); }
  });
  return router;
}

export default createAssistantRouter();
