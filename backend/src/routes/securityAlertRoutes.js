import { Router } from "express";
import {
  createSecurityAlert,
  getAllSecurityAlerts,
  updateSecurityAlertStatus,
  getMySecurityAlerts
} from "../controllers/securityAlertController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export function createSecurityRouter({auth=requireAuth}={}) {
const router = Router();
const safe = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);

const SECURITY_READ_ROLES = ["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];

// N'importe quel compte authentifié peut créer une alerte (appel mobile public)
router.post("/",     auth, safe(createSecurityAlert));
// L'utilisateur voit ses propres alertes (historique mobile)
router.get("/mine",  auth, safe(getMySecurityAlerts));
// Lecture et traitement réservés aux services habilités
router.get("/",      auth, safe(getAllSecurityAlerts));
router.patch("/:id", auth, safe(updateSecurityAlertStatus));

return router;
}
export default createSecurityRouter();
