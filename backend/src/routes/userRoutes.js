import { Router } from "express";
import {
  createUser,
  deleteUser,
  listPendingChefs,
  listUsers,
  reviewChef,
  setUserActiveStatus,
  updateUser
} from "../controllers/userController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();
const safe = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const ADMIN_ROLES = [
  "NATIONAL", "REGULATOR",
  "REGION", "DISTRICT",
  "ETABLISSEMENT", "CHEF_ETABLISSEMENT",
  "SAMU", "SAPEUR_POMPIER", "POLICE", "GENDARMERIE", "PROTECTION_CIVILE"
];

router.use(requireAuth, requireRole(ADMIN_ROLES));
router.get("/", safe(listUsers));
router.get("/pending-chefs", safe(listPendingChefs));
router.post("/:id/review", safe(reviewChef));
router.post("/", safe(createUser));
router.patch("/:id", safe(updateUser));
router.patch("/:id/active", safe(setUserActiveStatus));
router.delete("/:id", safe(deleteUser));

export default router;
