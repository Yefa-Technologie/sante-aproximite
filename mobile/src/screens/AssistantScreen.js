import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import NetInfo from "@react-native-community/netinfo";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { C } from "../theme";
import { createVoiceActivity, sampleVoiceActivity } from "../audio/voiceActivity.cjs";
import { OFFLINE_MESSAGE, isOffline, feedbackForFailure, buildAssistantHistory } from "../audio/assistantFeedback.cjs";
import { readWithDeviceVoice, toSpokenText } from "../audio/deviceSpeech.cjs";

const greeting = { role: "assistant", content: "Bonjour ! Posez votre question par écrit ou avec le micro. Après votre vocal, choisissez Envoyer ou Annuler." };

export function AssistantScreen({ actions = [], onNavigate = () => {}, onAsk, onShowResults, title = "Votre assistant IA", welcomeMessage = greeting.content, initialQuestion = "" }) {
  const { token } = useAuth();
  const [messages, setMessages] = useState([{ role: "assistant", content: welcomeMessage }]);
  const [draft, setDraft] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [voice, setVoice] = useState(true);
  const [pendingAutoRead, setPendingAutoRead] = useState(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [preparingMic, setPreparingMic] = useState(false);
  const [preparingVoice, setPreparingVoice] = useState(false);
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [pendingVoice, setPendingVoice] = useState(null);
  const [offline, setOffline] = useState(false);
  const [levels, setLevels] = useState(Array(24).fill(0.08));
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recordingState = useAudioRecorderState(recorder, 150);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const scroll = useRef(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const voiceRef = useRef(true);
  const recording = useRef(false);
  const micOperation = useRef(false);
  const micVersion = useRef(0);
  const requestingPermission = useRef(false);
  const recordingTimer = useRef(null);
  const recordingStarted = useRef(0);
  const activity = useRef(null);
  const finishRecording = useRef(null);
  const pendingRef = useRef(null);
  const speechVersion = useRef(0);
  const speechFile = useRef(null);
  const inputBusy = busy || preparingMic || recordingState.isRecording;

  function addMessage(message) {
    if (mounted.current) setMessages((previous) => [...previous, message]);
  }
  async function networkState() { return NetInfo.fetch().catch(() => null); }
  async function ensureOnline() {
    if (isOffline(await networkState())) {
      const error = new Error(OFFLINE_MESSAGE);
      error.code = "ASSISTANT_OFFLINE";
      throw error;
    }
  }
  function localFeedback(text) {
    addMessage({ role: "assistant", content: text, notice: true });
    if (voiceRef.current && mounted.current && AppState.currentState === "active") {
      Speech.stop();
      Speech.speak(toSpokenText(text), { language: "fr-FR", rate: 0.98 });
    }
  }
  async function reportFailure(error) {
    if (!mounted.current) return;
    const text = feedbackForFailure(error, await networkState());
    if (mounted.current) localFeedback(text);
  }
  function stopSpeaking() {
    speechVersion.current += 1;
    try { player.pause(); player.replace(null); } catch {}
    Speech.stop();
    if (speechFile.current) FileSystem.deleteAsync(speechFile.current, { idempotent: true }).catch(() => {});
    speechFile.current = null;
    if (mounted.current) setPreparingVoice(false);
    if (mounted.current) setDeviceVoice(false);
  }
  function updatePending(value) {
    pendingRef.current = value;
    if (mounted.current) setPendingVoice(value);
  }
  async function clearPending() {
    stopSpeaking();
    const saved = pendingRef.current;
    updatePending(null);
    if (saved?.uri) await FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => {});
  }
  async function discardRecording() {
    micVersion.current += 1;
    clearTimeout(recordingTimer.current);
    if (!recording.current) return;
    micOperation.current = true;
    recording.current = false;
    try {
      await recorder.stop();
      if (recorder.uri) await FileSystem.deleteAsync(recorder.uri, { idempotent: true });
    } catch {}
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    micOperation.current = false;
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(isOffline(state)));
    const sub = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
      if (state !== "active" && !requestingPermission.current) { stopSpeaking(); discardRecording(); }
    });
    return () => {
      mounted.current = false;
      unsubscribe(); sub.remove(); stopSpeaking(); discardRecording();
      if (pendingRef.current?.uri) FileSystem.deleteAsync(pendingRef.current.uri, { idempotent: true }).catch(() => {});
    };
  }, []);
  useEffect(() => { if (playerStatus.didJustFinish) stopSpeaking(); }, [playerStatus.didJustFinish]);
  // Start only after the answer is rendered and recording cleanup has completed.
  // If the answer arrived in the background, read it when the app becomes active.
  useEffect(() => {
    if (!pendingAutoRead || !voice || !appActive || busy) return;
    setPendingAutoRead(null);
    void speak(pendingAutoRead);
  }, [pendingAutoRead, voice, appActive, busy]);
  useEffect(() => {
    if (!recording.current || !recordingState.isRecording || !activity.current) return;
    const level = Number.isFinite(recordingState.metering) ? Math.max(0.08, Math.min(1, (recordingState.metering + 60) / 50)) : 0.08;
    setLevels((previous) => [...previous.slice(1), level]);
    const result = sampleVoiceActivity(activity.current, recordingState.metering, Date.now());
    if (result === "finished") finishRecording.current?.();
    if (result === "silence") {
      discardRecording();
      localFeedback("Je n’ai pas entendu de question. Touchez le micro pour recommencer.");
    }
  }, [recordingState.durationMillis, recordingState.metering, recordingState.isRecording]);

  async function speak(text) {
    text = toSpokenText(text);
    if (!text) return;
    if (recording.current || micOperation.current) return;
    stopSpeaking();
    const version = speechVersion.current;
    setPreparingVoice(true);
    let file = null;
    try {
      await ensureOnline();
      const data = await apiFetch("/assistant/speech", { token, method: "POST", body: { text: text.slice(0, 3500) }, timeoutMs: 35000, queueOffline: false });
      if (!mounted.current || version !== speechVersion.current || AppState.currentState !== "active") return;
      if (typeof data.audio !== "string" || !data.audio) throw new Error("EMPTY_AUDIO");
      file = `${FileSystem.cacheDirectory}assistant-voice-${Date.now()}-${version}.wav`;
      await FileSystem.writeAsStringAsync(file, data.audio, { encoding: FileSystem.EncodingType.Base64 });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
      if (!mounted.current || version !== speechVersion.current || AppState.currentState !== "active") {
        await FileSystem.deleteAsync(file, { idempotent: true }); return;
      }
      speechFile.current = file;
      player.replace({ uri: file }); player.play();
    } catch (error) {
      if (file) FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
      if (mounted.current && version === speechVersion.current) {
        const network = await networkState();
        if (error.code === "ASSISTANT_OFFLINE" || isOffline(network)) {
          await reportFailure(error);
        } else {
          const canPlay = () => mounted.current && version === speechVersion.current && AppState.currentState === "active" && !recording.current;
          const finish = () => { if (mounted.current && version === speechVersion.current) setDeviceVoice(false); };
          const failed = () => {
            finish();
            if (canPlay()) addMessage({ role: "assistant", notice: true, content: feedbackForFailure({ code: "VOICE_UNAVAILABLE" }, network) });
          };
          try {
            await readWithDeviceVoice(text, {
              getVoices: Speech.getAvailableVoicesAsync, stop: Speech.stop, speak: Speech.speak,
              maxLength: Speech.maxSpeechInputLength, canPlay,
              onStart: () => setDeviceVoice(true), onDone: finish, onError: failed
            });
          } catch { failed(); }
        }
      }
    } finally {
      if (mounted.current && version === speechVersion.current) setPreparingVoice(false);
    }
  }

  async function startRecording() {
    if (inputBusy || pendingRef.current || sending.current || micOperation.current) return;
    if (Platform.OS === "web") { localFeedback("Le micro est disponible dans l’application Android et iOS."); return; }
    micOperation.current = true;
    setPreparingMic(true);
    stopSpeaking();
    const version = ++micVersion.current;
    try {
      await ensureOnline();
      requestingPermission.current = true;
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        localFeedback("Autorisez le microphone dans les réglages de l’appareil pour enregistrer votre question."); return;
      }
      for (let i = 0; i < 10 && mounted.current && AppState.currentState !== "active"; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      requestingPermission.current = false;
      if (!mounted.current || version !== micVersion.current || AppState.currentState !== "active") return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      if (!mounted.current || version !== micVersion.current || AppState.currentState !== "active") {
        await recorder.stop();
        if (recorder.uri) await FileSystem.deleteAsync(recorder.uri, { idempotent: true });
        return;
      }
      recorder.record(); recording.current = true;
      recordingStarted.current = Date.now(); activity.current = createVoiceActivity(Date.now());
      setLevels(Array(24).fill(0.08));
      recordingTimer.current = setTimeout(() => finishRecording.current?.(), 60000);
    } catch (error) { await reportFailure(error); }
    finally {
      requestingPermission.current = false; micOperation.current = false;
      if (!recording.current) await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current) setPreparingMic(false);
    }
  }

  async function stopRecording() {
    if (!recording.current || micOperation.current) return;
    micOperation.current = true; recording.current = false;
    clearTimeout(recordingTimer.current);
    const version = micVersion.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("EMPTY_RECORDING");
      await setAudioModeAsync({ allowsRecording: false });
      if (!mounted.current || version !== micVersion.current) {
        await FileSystem.deleteAsync(uri, { idempotent: true }); return;
      }
      // No upload or transcription before the explicit Send action.
      updatePending({ uri, duration: Math.max(1, Math.round((Date.now() - recordingStarted.current) / 1000)), transcript: null });
    } catch { if (mounted.current) localFeedback("L’enregistrement a échoué. Touchez le micro pour réessayer."); }
    finally { micOperation.current = false; }
  }
  finishRecording.current = stopRecording;

  async function previewRecording() {
    if (!pendingRef.current || busy) return;
    stopSpeaking();
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
      if (mounted.current && pendingRef.current) { player.replace({ uri: pendingRef.current.uri }); player.play(); }
    } catch { localFeedback("La lecture du vocal a échoué. Vous pouvez l’annuler et recommencer."); }
  }

  async function send() {
    if (inputBusy || sending.current || micOperation.current || (!pendingRef.current && !draft.trim())) return;
    sending.current = true; setBusy(true); setPendingAutoRead(null); stopSpeaking();
    let question = draft.trim();
    const saved = pendingRef.current;
    try {
      setStage("Envoi de votre question…");
      await ensureOnline();
      if (saved) {
        question = saved.transcript;
        if (!question) {
          setStage("Transcription de votre vocal…");
          const info = await FileSystem.getInfoAsync(saved.uri);
          if (!info.exists || info.size > 3 * 1024 * 1024) throw new Error("INVALID_RECORDING");
          const audio = await FileSystem.readAsStringAsync(saved.uri, { encoding: FileSystem.EncodingType.Base64 });
          const data = await apiFetch("/assistant/transcribe", { token, method: "POST", body: { audio }, timeoutMs: 35000, queueOffline: false });
          if (typeof data.text !== "string" || !data.text.trim()) throw Object.assign(new Error("NO_SPEECH"), { status: 422 });
          question = data.text.trim().slice(0, 2000);
          if (!mounted.current) return;
          updatePending({ ...saved, transcript: question });
        }
      }
      if (!mounted.current) return;
      const history = buildAssistantHistory(messages, question);
      addMessage({ role: "user", content: question });
      setStage("L’assistant prépare votre réponse…");
      await ensureOnline();
      const data = onAsk ? await onAsk(question) : await apiFetch("/assistant/chat", { token, method: "POST", body: { messages: history }, timeoutMs: 35000, queueOffline: false });
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("EMPTY_REPLY");
      if (!mounted.current) return;
      if (saved) await clearPending();
      addMessage({ role: "assistant", content: data.reply, hasSearchResults: data.hasSearchResults === true });
      setDraft("");
      setPendingAutoRead(data.reply);
    } catch (error) { await reportFailure(error); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); setStage(""); } }
  }

  const waveform = (recordingState.isRecording || pendingVoice) && (
    <View accessibilityLabel={recordingState.isRecording ? "Niveau sonore du microphone" : "Vocal enregistré"} style={{ flexDirection: "row", height: 46, alignItems: "center", justifyContent: "center", gap: 4 }}>
      {levels.map((level, index) => <View key={index} style={{ width: 5, borderRadius: 3, height: 5 + level * 35, backgroundColor: recordingState.isRecording ? C.red : C.primary }} />)}
    </View>
  );
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>Aide à l’orientation, sans diagnostic. En cas de danger immédiat, contactez les secours locaux sans attendre le chat.</Text>
        <View style={styles.row}>
          <Text style={styles.text}>Réponses à voix haute</Text>
          <Switch accessibilityLabel="Lecture automatique des réponses" value={voice} onValueChange={(value) => { setVoice(value); voiceRef.current = value; if (!value) stopSpeaking(); }} />
        </View>
        {deviceVoice && <Text style={styles.note}>Lecture avec la voix du téléphone.</Text>}
        {(preparingVoice || playerStatus.playing || deviceVoice) && <Pressable accessibilityRole="button" onPress={stopSpeaking}><Text style={styles.link}>{preparingVoice ? "Préparation de la voix… Arrêter" : "Arrêter la lecture"}</Text></Pressable>}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.conversation} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        <Text style={styles.note}>vous utilisez une IA, qui, pourra utiliser vos donner pour entrainement du model, Évitez donc les informations personnelles ou médicales identifiantes</Text>
        {messages.map((message, index) => <View key={index} style={[styles.bubble, message.role === "user" && styles.userBubble, message.notice && { backgroundColor: C.orangeLight }]}>
          <Text style={styles.author}>{message.role === "user" ? "Vous" : "Assistant IA"}</Text>
          <Text selectable accessibilityLiveRegion={message.notice ? "polite" : "none"} style={styles.text}>{message.content}</Text>
          {message.hasSearchResults && !messages.slice(index + 1).some((entry) => entry.hasSearchResults) && onShowResults && <Pressable accessibilityRole="button" onPress={onShowResults} style={styles.shortcut}><Text style={styles.link}>Afficher les centres trouvés</Text></Pressable>}
          {message.role === "assistant" && !message.notice && <Pressable disabled={inputBusy || !!pendingVoice} accessibilityRole="button" onPress={() => speak(message.content)}><Text style={styles.link}>Écouter</Text></Pressable>}
        </View>)}
        {busy && <View style={styles.row}><ActivityIndicator color={C.primary} /><Text accessibilityLiveRegion="polite" style={styles.note}>{stage}</Text></View>}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.shortcuts}>{actions.map((action) => <Pressable accessibilityRole="button" key={action.key} onPress={() => onNavigate(action.key)} style={styles.shortcut}><Text style={styles.link}>{action.label}</Text></Pressable>)}</View>
        {offline && <Text accessibilityRole="alert" style={{ color: C.red }}>{OFFLINE_MESSAGE}</Text>}
        {waveform}
        {pendingVoice ? <>
          <Text style={styles.text}>Vocal prêt · {pendingVoice.duration} s</Text>
          <Text style={styles.note}>Écoutez votre vocal, puis choisissez Envoyer ou Annuler.</Text>
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={previewRecording}><Text style={styles.link}>▶ Écouter le vocal</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={clearPending}><Text style={[styles.link, { color: C.red }]}>Annuler</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={send} style={[styles.send, busy && { opacity: 0.5 }]}><Text style={{ color: "white", fontWeight: "700" }}>{busy ? "Envoi…" : "Envoyer"}</Text></Pressable>
          </View>
        </> : <>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={recordingState.isRecording ? "Terminer le vocal" : "Enregistrer une question vocale"} disabled={busy || preparingMic} onPress={recordingState.isRecording ? stopRecording : startRecording} style={[styles.send, recordingState.isRecording && { backgroundColor: C.red }]}>
              <Text style={{ color: "white", fontWeight: "700" }}>{recordingState.isRecording ? `■ Terminer · ${Math.floor(recordingState.durationMillis / 1000)} s` : preparingMic ? "Activation…" : "🎙"}</Text>
            </Pressable>
            {recordingState.isRecording && <Pressable accessibilityRole="button" onPress={discardRecording}><Text style={[styles.link, { color: C.red }]}>Annuler</Text></Pressable>}
          </View>
          <Text style={styles.note}>{recordingState.isRecording ? "Parlez… Une pause termine le vocal. Vous déciderez ensuite de l’envoyer ou de l’annuler." : "Touchez le micro pour enregistrer une question, ou écrivez ci-dessous."}</Text>
          <View style={styles.row}>
            <TextInput accessibilityLabel="Votre question" placeholder="Comment puis-je vous aider ?" placeholderTextColor={C.textMuted} value={draft} onChangeText={setDraft} multiline maxLength={2000} editable={!inputBusy} style={styles.input} />
            <Pressable accessibilityRole="button" disabled={inputBusy || !draft.trim()} onPress={send} style={[styles.send, (inputBusy || !draft.trim()) && { opacity: 0.5 }]}><Text style={{ color: "white", fontWeight: "700" }}>Envoyer</Text></Pressable>
          </View>
        </>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, gap: 8, backgroundColor: C.surface },
  title: { fontSize: 21, fontWeight: "700", color: C.textDark },
  note: { fontSize: 12, lineHeight: 18, color: C.textMuted },
  text: { fontSize: 15, lineHeight: 23, color: C.textDark },
  row: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" },
  conversation: { padding: 16, gap: 12 },
  bubble: { padding: 14, borderRadius: 16, backgroundColor: C.surface, marginRight: 20, gap: 7 },
  userBubble: { backgroundColor: C.primaryLight, marginRight: 0, marginLeft: 20 },
  author: { fontSize: 12, fontWeight: "700", color: C.textMuted },
  link: { color: C.primary, fontWeight: "600", paddingVertical: 6 },
  footer: { padding: 12, gap: 8, backgroundColor: C.surface },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shortcut: { borderRadius: 10, backgroundColor: C.primaryLight, paddingHorizontal: 10 },
  input: { flex: 1, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, maxHeight: 110, color: C.textDark },
  send: { padding: 13, borderRadius: 12, backgroundColor: C.primary }
});
