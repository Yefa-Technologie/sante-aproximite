import { Router } from "express";
import { login, mobileUserSession, refresh, register } from "../controllers/authController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { getProfile, updateProfile } from "../controllers/profileController.js";

const router = Router();
router.get("/profile", requireAuth, getProfile);
router.patch("/profile", requireAuth, updateProfile);

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/mobile-user-session", mobileUserSession);

export default router;
