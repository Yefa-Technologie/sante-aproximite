import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { readPolicy,writePolicy,readAccess,listAccess,writeAccess,listZones,writeZone,createSelectedZones } from "../controllers/incidentConfigController.js";
import { listIncidents,incidentDetail,transferIncident,changeIncidentStatus,transferTargets,revokeReinforcement } from "../services/incidentService.js";
export function createIncidentRouter({auth=requireAuth}={}) {
const router=Router();
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use(auth,(req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/policy",safe(readPolicy));router.put("/policy",safe(writePolicy));
router.get("/access/mine",safe(readAccess));router.get("/access",safe(listAccess));router.put("/access/:userId",safe(writeAccess));
router.get("/transfer-targets",safe(transferTargets));
router.post("/zones/selection",safe(createSelectedZones));
router.get("/zones",safe(listZones));router.post("/zones",safe(writeZone));router.put("/zones/:id",safe(writeZone));
router.use("/:kind",(req,res,next)=>{if(!["medical","security"].includes(req.params.kind))return res.sendStatus(404);req.incidentKind=req.params.kind;next();});
router.get("/:kind/map",safe((req,res)=>listIncidents(req.incidentKind,req,res)));
router.get("/:kind/stats",safe((req,res)=>listIncidents(req.incidentKind,req,res,{stats:true})));
router.get("/:kind/export",safe((req,res)=>listIncidents(req.incidentKind,req,res,{exportCsv:true})));
router.get("/:kind",safe((req,res)=>listIncidents(req.incidentKind,req,res)));
router.get("/:kind/:id/photos/:index",safe((req,res)=>incidentDetail(req.incidentKind,req,res,{photo:true})));
router.get("/:kind/:id",safe((req,res)=>incidentDetail(req.incidentKind,req,res)));
router.patch("/:kind/:id/status",safe((req,res)=>changeIncidentStatus(req.incidentKind,req,res)));
router.post("/:kind/:id/transfer",safe((req,res)=>transferIncident(req.incidentKind,req,res)));
router.post("/:kind/:id/revoke-reinforcement",safe((req,res)=>revokeReinforcement(req.incidentKind,req,res)));
return router;
}
export default createIncidentRouter();
