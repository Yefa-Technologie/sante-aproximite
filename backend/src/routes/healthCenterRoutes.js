import { Router } from "express";
import {
  addService,
  checkinByCode,
  claimCenterByCode,
  confirmVisitByPro,
  createComplaint,
  createCenter,
  createSuggestion,
  deleteCenterByAdmin,
  deleteAllCenters,
  exportEspcCenters,
  getCenterComplaints,
  getCenterSuggestions,
  getAllCenters,
  getCentersSync,
  getCheckinCode,
  getMyVisits,
  getNearbyCenters,
  importCenters,
  listPendingCenters,
  rateCenter,
  reviewCenter,
  selfDeclareVisit,
  setCenterActiveByAdmin,
  updateCenterByAdmin,
  updateCenter,
  updateCenterService
} from "../controllers/healthCenterController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();
const ADMIN_ROLES = ["REGULATOR", "NATIONAL", "REGION", "DISTRICT"];
const ETABLISSEMENT_ROLES = ["ETABLISSEMENT", "CHEF_ETABLISSEMENT"];
const CENTER_CREATE_ROLES = [...new Set([...ETABLISSEMENT_ROLES, ...ADMIN_ROLES])];

router.get("/my-visits", requireAuth, getMyVisits);
router.post("/claim-by-code", requireAuth, requireRole(ETABLISSEMENT_ROLES), claimCenterByCode);
router.get("/", requireAuth, getAllCenters);
router.get("/sync", requireAuth, getCentersSync);
router.get("/nearby", requireAuth, getNearbyCenters);
router.get("/export/espc", requireAuth, requireRole(ADMIN_ROLES), exportEspcCenters);
router.get("/pending", requireAuth, requireRole(ADMIN_ROLES), listPendingCenters);
router.delete("/all", requireAuth, requireRole(ADMIN_ROLES), deleteAllCenters);
router.get("/:id/complaints", requireAuth, getCenterComplaints);
router.get("/:id/suggestions", requireAuth, getCenterSuggestions);
router.post("/:id/review", requireAuth, requireRole(ADMIN_ROLES), reviewCenter);
router.post("/", requireAuth, requireRole(CENTER_CREATE_ROLES), createCenter);
router.put("/:id", requireAuth, requireRole(ETABLISSEMENT_ROLES), updateCenter);
router.put("/:id/admin", requireAuth, requireRole(ADMIN_ROLES), updateCenterByAdmin);
router.patch("/:id/active", requireAuth, requireRole([...ADMIN_ROLES, ...ETABLISSEMENT_ROLES]), setCenterActiveByAdmin);
router.delete("/:id", requireAuth, requireRole([...ADMIN_ROLES, ...ETABLISSEMENT_ROLES]), deleteCenterByAdmin);
router.post("/import", requireAuth, requireRole(ADMIN_ROLES), importCenters);
router.post("/:id/complaints", requireAuth, createComplaint);
router.post("/:id/suggestions", requireAuth, createSuggestion);
router.post("/:id/services", requireAuth, requireRole(ETABLISSEMENT_ROLES), addService);
router.patch("/:id/services/:serviceName", requireAuth, requireRole([...ADMIN_ROLES, ...ETABLISSEMENT_ROLES]), updateCenterService);
router.post("/:id/rating", requireAuth, rateCenter);
router.get("/:id/checkin-code", requireAuth, requireRole(ETABLISSEMENT_ROLES), getCheckinCode);
router.post("/:id/checkin", requireAuth, checkinByCode);
router.post("/:id/declare-visit", requireAuth, selfDeclareVisit);
router.post("/:id/confirm-visit", requireAuth, requireRole(ETABLISSEMENT_ROLES), confirmVisitByPro);

export default router;
