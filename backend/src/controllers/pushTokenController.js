import { registerPushToken } from "../services/notificationService.js";

export async function savePushToken(req, res) {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    return res.status(400).json({ message: "token requis" });
  }
  const appKey = typeof req.body?.appKey === "string" && req.body.appKey.trim() ? req.body.appKey.trim() : "mobile";

  await registerPushToken(Number(req.user.id), token, appKey);
  return res.json({ success: true });
}
