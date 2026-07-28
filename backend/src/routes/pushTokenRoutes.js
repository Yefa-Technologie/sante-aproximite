import { Router } from "express";
import { savePushToken } from "../controllers/pushTokenController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/", requireAuth, savePushToken);

export default router;
