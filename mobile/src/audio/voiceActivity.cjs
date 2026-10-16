// Simple energy-based end-of-utterance detection. No audio is sent for silence.
function createVoiceActivity(startedAt) {
  return { startedAt, lastSampleAt: startedAt, lastVoiceAt: null, voicedMs: 0, noiseDb: -60 };
}

function sampleVoiceActivity(state, decibels, now) {
  if (!Number.isFinite(decibels)) return now - state.startedAt >= 12000 ? "no-meter" : "listening";
  const elapsed = Math.max(0, Math.min(250, now - state.lastSampleAt));
  state.lastSampleAt = now;
  const threshold = Math.max(-48, Math.min(-24, state.noiseDb + 12));
  if (decibels > threshold) {
    state.voicedMs += elapsed;
    state.lastVoiceAt = now;
  } else if (state.lastVoiceAt === null) {
    state.noiseDb = state.noiseDb * 0.9 + decibels * 0.1;
  }
  if (state.voicedMs >= 400 && now - state.lastVoiceAt >= 1600) return "finished";
  if (now - state.startedAt >= 12000 && state.voicedMs < 400) return "silence";
  return state.voicedMs >= 400 ? "speaking" : "listening";
}

module.exports = { createVoiceActivity, sampleVoiceActivity };
