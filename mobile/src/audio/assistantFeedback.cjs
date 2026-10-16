const OFFLINE_MESSAGE = "Vous êtes hors connexion, vous ne pouvez donc pas utiliser l’assistant IA. Pour l’utiliser, activez votre connexion internet.";
const UNAVAILABLE_MESSAGE = "Assistant IA indisponible, veuillez réessayer plus tard.";
const SERVICE_ERROR_MESSAGE = "Une erreur est survenue pendant le traitement de votre demande. Veuillez réessayer.";
const VOICE_ERROR_MESSAGE = "La lecture vocale a échoué. Votre réponse reste disponible à l’écran.";

function isOffline(network) {
  return network?.isConnected === false || network?.isInternetReachable === false;
}

function feedbackForFailure(error, network) {
  if (error?.code === "ASSISTANT_OFFLINE" || isOffline(network)) return OFFLINE_MESSAGE;
  if (error?.status === 422) return "Aucune parole n’a été reconnue. Annulez ce vocal et enregistrez à nouveau votre question.";
  // Never expose provider names, quotas, configuration, or upstream errors to mobile users.
  if (error?.code === "ASSISTANT_UNAVAILABLE" || error?.status === 429) return UNAVAILABLE_MESSAGE;
  if (error?.code === "VOICE_UNAVAILABLE") return VOICE_ERROR_MESSAGE;
  return SERVICE_ERROR_MESSAGE;
}

function buildAssistantHistory(messages, question) {
  return [...messages.filter((m) => !m.notice && ["user", "assistant"].includes(m.role))
    .map(({ role, content }) => ({ role, content: String(content).slice(0, 2000) })),
    { role: "user", content: question.slice(0, 2000) }].slice(-12);
}

module.exports = { OFFLINE_MESSAGE, UNAVAILABLE_MESSAGE, SERVICE_ERROR_MESSAGE, VOICE_ERROR_MESSAGE, isOffline, feedbackForFailure, buildAssistantHistory };
