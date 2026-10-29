import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { pool } from "../config/db.js";
import { createEmergencyRouter } from "../routes/emergencyRoutes.js";
import { cityKey, validPosition, notifyLocalEmergency } from "./localEmergencyService.js";

async function setup(t, query) {
  const original = pool.query; pool.query = query; t.after(() => { pool.query = original; });
  const app = express(); app.use(express.json());
  app.use(createEmergencyRouter({ auth: (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.user = { id: "12", role: "USER", roles: ["USER"] }; next();
  } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return (path, method = "GET", body, auth = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "test" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("city normalization ignores accents and positions reject coercion and invalid coordinates", () => {
  assert.equal(cityKey(" Bouaké "), cityKey("BOUAKE"));
  assert.ok(validPosition({ latitude: 5.3, longitude: -4 }));
  for (const p of [{latitude:null,longitude:0},{latitude:"5",longitude:2},{latitude:91,longitude:2},{latitude:0,longitude:0}]) assert.equal(validPosition(p), false);
});

test("location belongs to authenticated account and cannot be set for another account", async (t) => {
  const calls=[]; const request=await setup(t,async (...args)=>{calls.push(args);return{rows:[]};});
  assert.equal((await request("/location","PUT",{userId:999,latitude:7.69,longitude:-5.03,city:"Bouaké"})).status,200);
  assert.deepEqual(calls[0][1],[12,7.69,-5.03,"Bouaké","bouake"]);
  assert.equal((await request("/location","PUT",{latitude:100,longitude:0})).status,400);
  assert.equal((await request("/location","DELETE")).status,200);
  assert.deepEqual(calls[1][1],[12]);
});

test("local feed is authenticated and requires a recent saved position", async (t) => {
  let sql="";const request=await setup(t,async (query)=>{sql=query;return{rows:[]};});
  assert.equal((await request("/local-alerts","GET",undefined,false)).status,401);
  const response=await request("/local-alerts");
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal((await response.json()).needsLocation,true);
  assert.match(sql,/24 hours/);
});

test("local feed includes only public fields and filters scope, own alerts, age and closed reports",async(t)=>{
  const calls=[];const request=await setup(t,async(sql,params)=>{
    calls.push({sql,params});
    return {rows:sql.startsWith("SELECT city")?[{city:"Anyama"}]:[{id:8,city:"Anyama",status:"NEW",created_at:"2026-10-29T10:00:00Z",distance_km:2.9,same_city:true,phone_number:"private",description:"private",latitude:5,photos:["private"]}]};
  });
  const data=await(await request("/local-alerts?latitude=0&longitude=0&userId=999")).json();
  assert.deepEqual(data.alerts,[{id:"8",city:"Anyama",status:"NEW",createdAt:"2026-10-29T10:00:00Z",distanceKm:3,sameCity:true}]);
  assert.deepEqual(calls[1].params,[12]);
  assert.match(calls[1].sql,/er.user_id <> \$1/);
  assert.match(calls[1].sql,/er.status IN \('NEW','ACKNOWLEDGED','EN_ROUTE','ON_SITE'\)/);
  assert.match(calls[1].sql,/<= 20/);assert.match(calls[1].sql,/ul.city_key = er.city_key/);
});

test("targeted push is generic, uses fresh nearby recipients, and one failure does not stop others",async()=>{
  let sql;const delivered=[];
  await notifyLocalEmergency({id:8,phone_number:"private",description:"private",latitude:5},{
    query:async(q,params)=>{sql=q;assert.deepEqual(params,[8]);return{rows:[{user_id:1},{user_id:2}]};},
    send:async(id,payload)=>{delivered.push({id,payload});if(id===1)throw new Error("push unavailable");},
  });
  assert.equal(delivered.length,2);assert.match(sql,/24 hours/);assert.match(sql,/ul.user_id <> er.user_id/);
  assert.deepEqual(delivered[1].payload.data,{type:"LOCAL_EMERGENCY_ALERT",reportId:"8"});
  assert.ok(!JSON.stringify(delivered).includes("private"));
});
