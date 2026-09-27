import { Router } from "express";
import {
  confirmReferralReception,
  createReferral,
  listIncomingReferrals,
  listOutgoingReferrals,
  rejectReferralReception,
  releaseReferralBed
} from "../controllers/referralController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();
const ETABLISSEMENT_ROLES = ["ETABLISSEMENT", "CHEF_ETABLISSEMENT"];
const ORIGIN_ROLES = [...ETABLISSEMENT_ROLES, "SAMU", "SAPEUR_POMPIER"];

router.post("/", requireAuth, requireRole(ORIGIN_ROLES), createReferral);
router.get("/incoming", requireAuth, requireRole(ETABLISSEMENT_ROLES), listIncomingReferrals);
router.get("/outgoing", requireAuth, requireRole(ORIGIN_ROLES), listOutgoingReferrals);
router.post("/:id/confirm", requireAuth, requireRole(ETABLISSEMENT_ROLES), confirmReferralReception);
router.post("/:id/reject", requireAuth, requireRole(ETABLISSEMENT_ROLES), rejectReferralReception);
router.post("/:id/release-bed", requireAuth, requireRole(ETABLISSEMENT_ROLES), releaseReferralBed);

export default router;
