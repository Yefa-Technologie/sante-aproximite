import { Router } from "express";
import { getAppSettings, updateAppSetting } from "../controllers/appSettingsController.js";
import { getModuleSettings, updateModuleSetting } from "../controllers/moduleSettingsController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();
const ADMIN_ROLES = ["DEVELOPER", "REGULATOR", "NATIONAL", "REGION", "DISTRICT"];

router.get("/modules", requireAuth, getModuleSettings);
router.patch("/modules", requireAuth, requireRole(ADMIN_ROLES), updateModuleSetting);

router.get("/", requireAuth, getAppSettings);
router.patch("/:key", requireAuth, requireRole(ADMIN_ROLES), updateAppSetting);

export default router;
