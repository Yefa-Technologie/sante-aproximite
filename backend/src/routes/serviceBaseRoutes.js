import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { listServiceBases, myServiceBases, writeServiceBase } from "../services/serviceBaseService.js";
export function createServiceBaseRouter({auth=requireAuth}={}) {
const router = Router();
const safe = (handler) => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
router.use(auth);
router.get("/", safe(listServiceBases));
router.get("/mine", safe(myServiceBases));
router.post("/", safe(writeServiceBase));
router.put("/:id", safe(writeServiceBase));
return router;
}
export default createServiceBaseRouter();
