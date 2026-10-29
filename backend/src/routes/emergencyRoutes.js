import { Router } from "express";
import {
  acknowledgeEmergencyReport,
  createEmergencyBase,
  createEmergencyReport,
  getEmergencyBases,
  getEmergencyReports,
  getMyEmergencyReports,
  getNearbyEmergencyBases,
  updateEmergencyProgress
} from "../controllers/emergencyController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import { saveEmergencyLocation, removeEmergencyLocation, getLocalEmergencyAlerts } from "../services/localEmergencyService.js";

export function createEmergencyRouter({ auth = requireAuth } = {}) {
  const router = Router();
  const safe = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);

  // Opérations d'urgence : réservées aux services d'urgence uniquement
  // NATIONAL / REGULATOR / REGION / DISTRICT n'ont pas accès aux données opérationnelles
  const EMERGENCY_ROLES = ["SAMU", "SAPEUR_POMPIER"];

  // Signaler une urgence et consulter son propre suivi sont ouverts aux comptes connectés.
  router.post("/", auth, safe(createEmergencyReport));
  router.get("/", auth, requireRole(EMERGENCY_ROLES), safe(getEmergencyReports));
  router.get("/mine", auth, safe(getMyEmergencyReports));
  router.put("/location", auth, safe(saveEmergencyLocation));
  router.delete("/location", auth, safe(removeEmergencyLocation));
  router.get("/local-alerts", auth, safe(getLocalEmergencyAlerts));
  router.post("/:id/acknowledge", auth, requireRole(EMERGENCY_ROLES), safe(acknowledgeEmergencyReport));
  router.patch("/:id/progress", auth, requireRole(EMERGENCY_ROLES), safe(updateEmergencyProgress));
  router.post("/bases", auth, requireRole(["NATIONAL","REGULATOR"]), safe(createEmergencyBase));
  router.get("/bases", auth, requireRole(EMERGENCY_ROLES), safe(getEmergencyBases));
  router.get("/bases/nearby", auth, safe(getNearbyEmergencyBases));

  return router;
}

export default createEmergencyRouter();
