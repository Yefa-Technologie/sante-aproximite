import { Router } from "express";
import {
  getAllSuggestions,
  getMySuggestions,
  getSuggestionsSummary,
  markSuggestionRead
} from "../controllers/healthCenterController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/mine", requireAuth, getMySuggestions);
router.get("/summary", requireAuth, getSuggestionsSummary);
router.get("/", requireAuth, getAllSuggestions);
router.patch("/:id/read", requireAuth, markSuggestionRead);

export default router;
