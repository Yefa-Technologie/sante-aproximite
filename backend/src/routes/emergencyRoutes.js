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

  // Opérations d'urgence : réservées aux services d'urgence uniquement
  // NATIONAL / REGULATOR / REGION / DISTRICT n'ont pas accès aux données opérationnelles
  const EMERGENCY_ROLES = ["SAMU", "SAPEUR_POMPIER", "DEVELOPER"];

  // Signaler une urgence et consulter son propre suivi sont ouverts aux comptes connectés.
  router.post("/", auth, createEmergencyReport);
  router.get("/", auth, requireRole(EMERGENCY_ROLES), getEmergencyReports);
  router.get("/mine", auth, getMyEmergencyReports);
  router.put("/location", auth, saveEmergencyLocation);
  router.delete("/location", auth, removeEmergencyLocation);
  router.get("/local-alerts", auth, getLocalEmergencyAlerts);
  router.post("/:id/acknowledge", auth, requireRole(EMERGENCY_ROLES), acknowledgeEmergencyReport);
  router.patch("/:id/progress", auth, requireRole(EMERGENCY_ROLES), updateEmergencyProgress);
  router.post("/bases", auth, requireRole(EMERGENCY_ROLES), createEmergencyBase);
  router.get("/bases", auth, requireRole(EMERGENCY_ROLES), getEmergencyBases);
  router.get("/bases/nearby", auth, getNearbyEmergencyBases);

  return router;
}

export default createEmergencyRouter();
