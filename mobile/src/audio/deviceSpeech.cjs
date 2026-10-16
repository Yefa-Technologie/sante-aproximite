function toSpokenText(text) {
  return String(text || "").replace(/\*/g, "").replace(/[ \t]+/g, " ").trim();
}

function chooseFrenchVoice(voices) {
  return voices.filter((voice) => /^fr(?:-|$)/i.test(voice.language || ""))
    .sort((a, b) => {
      const score = (voice) => (/^fr-FR$/i.test(voice.language) ? 4 : 0) +
        (voice.quality === "Enhanced" ? 2 : 0) +
        (/female|femme|am[eé]lie|audrey|marie|denise|hortense|julie|sylvie/i.test(voice.name || "") ? 1 : 0);
      return score(b) - score(a);
    })[0]?.identifier;
}

// A successful text reply should still be spoken when only cloud TTS fails.
async function readWithDeviceVoice(text, { getVoices, stop, speak, canPlay, onStart, onDone, onError, maxLength = 3500 }) {
  text = toSpokenText(text);
  if (!text) return;
  const voices = await getVoices().catch(() => []);
  if (!canPlay()) return;
  await stop();
  if (!canPlay()) return;
  onStart();
  speak(text.slice(0, Math.min(3500, maxLength)), {
    language: "fr-FR", voice: chooseFrenchVoice(voices), rate: 0.98, pitch: 1.04,
    onDone, onStopped: onDone, onError
  });
}

module.exports = { toSpokenText, chooseFrenchVoice, readWithDeviceVoice };
