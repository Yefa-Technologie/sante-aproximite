import { Router } from "express";
import {
  createSecurityAlert,
  getAllSecurityAlerts,
  updateSecurityAlertStatus,
  getMySecurityAlerts
} from "../controllers/securityAlertController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();
const safe = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);

const SECURITY_READ_ROLES = ["POLICE", "GENDARMERIE", "PROTECTION_CIVILE"];

// N'importe quel compte authentifié peut créer une alerte (appel mobile public)
router.post("/",     requireAuth, safe(createSecurityAlert));
// L'utilisateur voit ses propres alertes (historique mobile)
router.get("/mine",  requireAuth, safe(getMySecurityAlerts));
// Lecture et traitement réservés aux services habilités
router.get("/",      requireAuth, requireRole(SECURITY_READ_ROLES), safe(getAllSecurityAlerts));
router.patch("/:id", requireAuth, requireRole(SECURITY_READ_ROLES), safe(updateSecurityAlertStatus));

export default router;
