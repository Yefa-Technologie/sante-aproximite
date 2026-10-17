import dotenv from "dotenv";
import { mailConfig } from "./mailConfig.js";

dotenv.config();

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  geminiTranscriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL || "gemini-3.1-flash-lite",
  geminiSpeechModel: process.env.GEMINI_SPEECH_MODEL || "gemini-2.5-flash-preview-tts",
  geminiSpeechVoice: process.env.GEMINI_SPEECH_VOICE || "Aoede",
  host: process.env.HOST || "0.0.0.0",
  port: process.env.PORT || 5000,
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/sante_aproxmite",
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "dev_secret",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  ...mailConfig(process.env),
};
