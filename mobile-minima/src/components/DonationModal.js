import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, S } from "../theme";

export function DonationModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>Soutenir le projet</Text>
              <Text style={styles.headerTitle}>Faire un don via Wave</Text>
              <Text style={styles.headerSub}>Scannez le QR code avec l'application Wave pour envoyer votre don.</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.qrWrap}>
              <Image source={require("../../assets/wave-qr.png")} style={styles.qrImage} resizeMode="contain" />
            </View>
            <Text style={styles.helpText}>
              Ouvrez l'application Wave, appuyez sur "Scanner" puis visez ce QR code pour effectuer votre don. Merci pour votre soutien !
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.68)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    backgroundColor: "#00A3E0",
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: { flex: 1 },
  headerEyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  headerTitle: { color: "#fff", fontWeight: "900", fontSize: 22, marginTop: 5 },
  headerSub: { color: "rgba(255,255,255,0.88)", fontSize: 13, marginTop: 5, lineHeight: 19 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  body: { paddingHorizontal: 20, paddingVertical: 20, alignItems: "center" },
  qrWrap: {
    borderRadius: 18,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    ...S.sm,
  },
  qrImage: { width: 260, height: 335 },
  helpText: { marginTop: 16, fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 20 },
});
