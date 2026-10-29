import { registerPushToken } from "../services/notificationService.js";
import { pool } from "../config/db.js";

export async function savePushToken(req, res) {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token || token.length>220 || !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) {
    return res.status(400).json({ message: "token requis" });
  }
  const appKey = typeof req.body?.appKey === "string" && req.body.appKey.trim() ? req.body.appKey.trim() : "mobile";

  await registerPushToken(Number(req.user.id), token, appKey);
  return res.json({ success: true });
}
export async function removePushToken(req,res) {
  const token=req.body?.token;
  if(typeof token!=="string"||token.length>220)return res.status(400).json({message:"Jeton d’appareil invalide."});
  await pool.query("DELETE FROM push_tokens WHERE user_id=$1 AND token=$2",[Number(req.user.id),token]);
  res.json({success:true});
}
