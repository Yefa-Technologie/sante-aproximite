import { pool } from "../config/db.js";
import { writeServiceBase } from "../services/serviceBaseService.js";
import { createIncident,listIncidents,changeIncidentStatus } from "../services/incidentService.js";
function normalizeTargetService(raw) {
  const value=String(raw||"").trim().toUpperCase();
  return ["SAMU","SAPEUR_POMPIER","POLICE","GENDARMERIE","PROTECTION_CIVILE"].includes(value)?value:null;
}
function parseLatitude(raw) {if(raw==null||raw==="")return null;const n=Number(raw);return Number.isFinite(n)&&Math.abs(n)<=90?n:null;}
function parseLongitude(raw) {if(raw==null||raw==="")return null;const n=Number(raw);return Number.isFinite(n)&&Math.abs(n)<=180?n:null;}
function normalizeBaseRow(row) {return {id:String(row.id),name:row.name,serviceType:row.service_type,address:row.address,location:{type:"Point",coordinates:[Number(row.longitude),Number(row.latitude)]},approvalStatus:row.approval_status,distanceKm:row.distance_km==null?undefined:Number(row.distance_km),createdAt:row.created_at};}

export async function createEmergencyReport(req,res) { return createIncident("medical",req,res); }

export async function getEmergencyReports(req,res) { return listIncidents("medical",req,res); }

export async function getMyEmergencyReports(req,res) { return listIncidents("medical",req,res,{mine:true}); }

export async function acknowledgeEmergencyReport(req,res) { return changeIncidentStatus("medical",req,res,"ACKNOWLEDGED"); }

export async function updateEmergencyProgress(req,res) { return changeIncidentStatus("medical",req,res); }

export async function createEmergencyBase(req, res) { return writeServiceBase(req, res); }

export async function getEmergencyBases(req, res) {
  const requestedService = normalizeTargetService(req.query?.serviceType);
  const where = [];
  const params = [];

  where.push(`eb.is_active=TRUE`);
  where.push(`eb.approval_status = 'APPROVED'`);
  if (requestedService) {
    where.push(`eb.service_type = $${params.length + 1}`);
    params.push(requestedService);
  }

  const result = await pool.query(
    `
      SELECT eb.*
      FROM emergency_bases eb
      WHERE ${where.join(" AND ")}
      ORDER BY eb.created_at DESC
      LIMIT 400;
    `,
    params
  );

  return res.json(result.rows.map(normalizeBaseRow));
}

export async function getNearbyEmergencyBases(req, res) {
  const latitude = parseLatitude(req.query?.latitude);
  const longitude = parseLongitude(req.query?.longitude);
  const radiusKm = Number(req.query?.radiusKm);
  const validRadius = Number.isFinite(radiusKm) && radiusKm > 0
    ? Math.min(700, Math.max(1, radiusKm))
    : 30;
  const requestedService = normalizeTargetService(req.query?.serviceType);

  if (latitude == null || longitude == null) {
    return res.status(400).json({ message: "latitude et longitude sont obligatoires." });
  }

  const params = [latitude, longitude, validRadius];
  const whereParts = [`distance_km <= $3`, `approval_status = 'APPROVED'`];

  if (requestedService) {
    whereParts.push(`service_type = $4`);
    params.push(requestedService);
  }

  const result = await pool.query(
    `
      WITH bases AS (
        SELECT
          eb.*,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(eb.latitude)) *
                cos(radians(eb.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(eb.latitude))
              ))
            )
          ) AS distance_km
        FROM emergency_bases eb
      )
      SELECT *
      FROM bases
      WHERE ${whereParts.join(" AND ")}
      ORDER BY distance_km ASC
      LIMIT 200;
    `,
    params
  );

  return res.json(result.rows.map(normalizeBaseRow));
}
