import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { pool } from "../config/db.js";
import { createEmergencyRouter } from "../routes/emergencyRoutes.js";
import { cityKey, validPosition, notifyLocalEmergency } from "./localEmergencyService.js";

async function setup(t, query, role="USER") {
  const original = pool.query; pool.query = query; t.after(() => { pool.query = original; });
  const app = express(); app.use(express.json());
  app.use(createEmergencyRouter({ auth: (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.user = { id: "12", role, roles: [role] }; next();
  } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return (path, method = "GET", body, auth = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "test" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("city normalization and GPS validation",()=>{
  assert.equal(cityKey("Bouaké"),cityKey("BOUAKE"));
  assert.ok(validPosition({latitude:5,longitude:-4}));
  assert.equal(validPosition({latitude:null,longitude:0}),false);
});
test("public users and developer-only accounts cannot access incoming alerts or register GPS",async t=>{
  const request=await setup(t,()=>{throw Error("Must not query private incidents");});
  assert.equal((await request("/local-alerts","GET",undefined,false)).status,401);
  assert.equal((await request("/local-alerts")).status,403);
  assert.equal((await request("/location","PUT",{latitude:5,longitude:-4})).status,403);
});
test("responders without an active assigned base receive no incidents",async t=>{
  const request=await setup(t,async()=>({rows:[]}),"SAMU");
  const response=await request("/local-alerts");assert.equal(response.headers.get("cache-control"),"no-store");
  assert.deepEqual(await response.json(),{alerts:[],bases:[],needsAssignment:true});
});
test("private feed is scoped by assigned base, service and geography and hides details",async t=>{
  const calls=[];const request=await setup(t,async(sql,params)=>{
    calls.push({sql,params});return{rows:sql.includes("SELECT eb.*")?[{id:3,name:"Base",service_type:"SAMU",city:"Bouaké",latitude:7.7,longitude:-5,radius_km:20}]:[{id:8,city:"Bouaké",status:"NEW",created_at:"2026-10-29",kind:"medical",target_service:"SAMU",phone_number:"private"}]};
  },"SAMU");
  const data=await(await request("/local-alerts?userId=999")).json();assert.equal(data.alerts.length,1);
  assert.equal(data.alerts[0].phone_number,undefined);assert.equal(data.needsAssignment,false);
  assert.deepEqual(calls[1].params,[12,["SAMU"]]);assert.match(calls[1].sql,/user_service_bases/);assert.match(calls[1].sql,/eb.radius_km/);
});
test("push targets only active responders assigned to matching bases; failures stay isolated",async()=>{
  let sql;const delivered=[];
  await notifyLocalEmergency({id:8},{query:async(q,p)=>{sql=q;assert.deepEqual(p,[8]);return{rows:[{user_id:1},{user_id:2}]};},send:async(id,payload)=>{delivered.push(payload);if(id===1)throw Error("offline");}});
  assert.equal(delivered.length,2);assert.match(sql,/user_service_bases/);assert.match(sql,/eb.is_active=TRUE/);assert.match(sql,/u.role=usb.service_type/);assert.match(sql,/eb.radius_km/);
  assert.deepEqual(delivered[1].data,{type:"LOCAL_EMERGENCY_ALERT",reportId:"8",kind:"medical"});
});
