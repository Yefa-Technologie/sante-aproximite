import { Router } from "express";
import { savePushToken,removePushToken } from "../controllers/pushTokenController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.post("/", requireAuth, safe(savePushToken));
router.delete("/", requireAuth, safe(removePushToken));

export default router;
