import { Router } from "express";
import { verifyToken } from "../services/authService.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import { logEvent, getSummary, getUserActions } from "../controllers/analyticsController.js";

const router = Router();

// Attach user if token present - never blocks the request
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token) {
      const decoded = verifyToken(token);
      req.user = decoded;
    }
  } catch {}
  next();
}

// Log an event - works with or without token
router.post("/event", optionalAuth, logEvent);

// Stats - DEVELOPER, NATIONAL, REGULATOR only
router.get("/summary", requireAuth, requireRole(["DEVELOPER", "NATIONAL", "REGULATOR"]), getSummary);

// Actions détaillées d'un utilisateur
router.get("/user/:userId", requireAuth, requireRole(["DEVELOPER", "NATIONAL", "REGULATOR"]), getUserActions);

export default router;
