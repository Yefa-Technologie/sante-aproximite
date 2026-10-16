const test = require("node:test");
const assert = require("node:assert/strict");
const { toSpokenText, chooseFrenchVoice, readWithDeviceVoice } = require("./deviceSpeech.cjs");

test("spoken text removes Markdown asterisks and keeps the actual French wording", () => {
  assert.equal(toSpokenText("**Centres de santé** : *ouvrez la carte*."), "Centres de santé : ouvrez la carte.");
  assert.equal(toSpokenText("* Mon profil\n* Suivi des plaintes"), "Mon profil\n Suivi des plaintes");
  assert.equal(toSpokenText("***"), "");
});

test("selects an installed French voice without requiring a specific engine", () => {
  assert.equal(chooseFrenchVoice([{ language: "en-US", identifier: "english" }, { language: "fr-FR", identifier: "french" }]), "french");
  assert.equal(chooseFrenchVoice([]), undefined);
});

test("reads the actual answer instead of an unavailability notice when cloud voice fails", async () => {
  let spoken; let started = false;
  await readWithDeviceVoice("Voici **votre réponse**.", {
    getVoices: async () => [], stop: async () => {}, canPlay: () => true,
    speak: (text, options) => { spoken = { text, options }; }, onStart: () => { started = true; }
  });
  assert.equal(spoken.text, "Voici votre réponse.");
  assert.equal(spoken.options.language, "fr-FR");
  assert.equal(started, true);
});

test("Stop or leaving the screen cancels a pending device fallback", async () => {
  let played = false;
  await readWithDeviceVoice("Réponse", {
    getVoices: async () => [], stop: async () => {}, canPlay: () => false,
    speak: () => { played = true; }, onStart: () => {}
  });
  assert.equal(played, false);
});
