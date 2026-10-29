import { createIncident,listIncidents,changeIncidentStatus } from "../services/incidentService.js";
export async function createSecurityAlert(req,res) { return createIncident("security",req,res); }
export async function getAllSecurityAlerts(req,res) { return listIncidents("security",req,res); }
export async function updateSecurityAlertStatus(req,res) { return changeIncidentStatus("security",req,res); }
export async function getMySecurityAlerts(req,res) { return listIncidents("security",req,res,{mine:true}); }
