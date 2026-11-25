import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {connectDb,pool} from "../config/db.js";
import {env} from "../config/env.js";
import {getSummary,getUserActions} from "../controllers/analyticsController.js";
import {createEmergencyRouter} from "../routes/emergencyRoutes.js";
import {createSecurityRouter} from "../routes/securityAlertRoutes.js";
import {createServiceBaseRouter} from "../routes/serviceBaseRoutes.js";
import {createIncidentRouter} from "../routes/incidentRoutes.js";
import {deliverIncidentNotifications} from "./incidentNotifications.js";

// Opt-in, local PostgreSQL only. All test data lives in temporary tables on one connection.
test("incidents: PostgreSQL + HTTP authorization, routing, history, outbox and transfers",{skip:process.env.RUN_INCIDENT_DB_TESTS!=="1"},async t=>{
  assert.ok(["localhost","127.0.0.1","::1"].includes(new URL(env.databaseUrl).hostname),"Integration tests must use a local database");
  const oldNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV="test";
  await connectDb();
  const originalQuery=pool.query,originalConnect=pool.connect,db=await pool.connect();
  let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}pool.query=originalQuery;pool.connect=originalConnect;if(oldNodeEnv==null)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNodeEnv;db.release();await pool.end();});
  for(const table of ["users","user_roles","emergency_bases","user_service_bases","emergency_reports","security_alerts","incident_policy","emergency_zones","incident_access_roles","incident_grants","incident_history","incident_notification_outbox","analytics_events","center_complaints"])
    {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
      if((await db.query("SELECT 1 FROM pg_attribute WHERE attrelid=$1::regclass AND attname='id' AND NOT attisdropped",[table])).rows.length) {
        await db.query(`CREATE TEMP SEQUENCE fixture_${table}_seq START 10000; ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('pg_temp.fixture_${table}_seq')`);
      }
    }
  pool.query=(...args)=>db.query(...args);pool.connect=async()=>({query:(...args)=>db.query(...args),release(){}});
  await db.query("INSERT INTO incident_policy(id,max_reports_per_minute) VALUES(1,30)");
  const accounts=[[100,"USER"],[101,"USER"],[201,"SAMU"],[202,"SAMU"],[203,"SAMU"],[301,"POLICE"],[302,"POLICE"],[999,"NATIONAL"],[998,"USER"],[1000,"USER"],[1001,"USER"]];
  for(const [id,role] of accounts){await db.query("INSERT INTO users(id,full_name,email,password_hash,role,approval_status) VALUES($1,$2,$3,'unused-test-password',$4,'APPROVED')",[id,`TEST FICTIF compte ${id}`,`fictif-${id}@example.invalid`,role]);await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)",[id,role]);}
  const bases=[[11,"SAMU","Bouaké",7.69,-5.03,true],[12,"SAMU","Korhogo",9.46,-5.63,true],[13,"SAMU","Renfort fictif",7.69,-5.02,true],[14,"SAMU","Centre inactif fictif",6,-4.5,false],[21,"POLICE","Bouaké",7.69,-5.03,true],[22,"POLICE","Korhogo",9.46,-5.63,true]];
  for(const [id,service,city,lat,lon,active] of bases)await db.query(`INSERT INTO emergency_bases(id,name,service_type,address,latitude,longitude,created_by,city,city_key,is_active,approval_status) VALUES($1,$2,$3,'Lieu de TEST FICTIF',$4,$5,999,$6,'test fictif',$7,'APPROVED')`,[id,`TEST FICTIF ${service} ${city}`,service,lat,lon,city,active]);
  for(const [user,base,service] of [[201,11,"SAMU"],[202,12,"SAMU"],[203,13,"SAMU"],[301,21,"POLICE"],[302,22,"POLICE"]])await db.query("INSERT INTO user_service_bases(user_id,base_id,service_type) VALUES($1,$2,$3)",[user,base,service]);
  const square=(lon,lat)=>({type:"Polygon",coordinates:[[[lon-.01,lat-.01],[lon+.01,lat-.01],[lon+.01,lat+.01],[lon-.01,lat+.01],[lon-.01,lat-.01]]]});
  for(const [id,base,lon,lat] of [[1,11,-5.03,7.69],[2,12,-5.63,9.46],[3,14,-4.5,6],[4,21,-5.03,7.69],[5,22,-5.63,9.46]])await db.query("INSERT INTO emergency_zones(id,base_id,name,geometry,is_test) VALUES($1,$2,'ZONE DE TEST FICTIVE — AUCUNE LIMITE OFFICIELLE',$3,TRUE)",[id,base,JSON.stringify(square(lon,lat))]);
  await db.query("INSERT INTO incident_access_roles(user_id,coordinate_all,coordinate_base_ids) VALUES(1000,TRUE,'{}'),(1001,FALSE,'{11}')");
  const app=express();app.use(express.json({limit:"20mb"}));
  const auth=async(req,res,next)=>{try{const id=Number(req.headers["x-test-user"]);if(!id)return res.sendStatus(401);const r=await db.query("SELECT id,role,ARRAY(SELECT role FROM user_roles WHERE user_id=u.id) AS roles FROM users u WHERE id=$1",[id]);if(!r.rows.length)return res.sendStatus(401);req.user=r.rows[0];next();}catch(e){next(e);}};
  app.use("/service-bases",createServiceBaseRouter({auth}));
  app.get("/legacy-summary",auth,(req,res,next)=>getSummary(req,res).catch(next));
  app.get("/legacy-user-actions/:userId",auth,(req,res,next)=>getUserActions(req,res).catch(next));
  app.use("/emergency-reports",createEmergencyRouter({auth}));app.use("/security-alerts",createSecurityRouter({auth}));app.use("/incidents",createIncidentRouter({auth}));
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  let counter=0;
  const body=(extra={})=>({targetService:"SAMU",emergencyType:"Accident de TEST FICTIF",pickupPointName:"REPÈRE BOUAKÉ FICTIF",description:"Description fictive pour vérification uniquement",phoneNumber:"0102030405",photos:[],latitude:7.69,longitude:-5.03,accuracyMeters:20,locationTimestamp:Date.now(),presenceConfirmed:true,victimCount:2,clientRequestId:`fixture_request_${++counter}`, ...extra});
  const request=async(path,user=100,method="GET",payload)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{"Content-Type":"application/json",...(user?{"x-test-user":String(user)}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  const json=async(response,status)=>{const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
  let bouake,korhogo,outside,ambiguous,inactive;
  await t.test("GPS required on legacy and new submission paths; old/imprecise/simulated/manual inputs rejected",async()=>{
    for(const change of [{latitude:null},{presenceConfirmed:false},{accuracyMeters:101},{locationTimestamp:Date.now()-61000},{locationTimestamp:Date.now()+60000},{locationMocked:true},{latitude:"7.69"}])await json(await request("/emergency-reports",100,"POST",body(change)),400);
    assert.equal((await request("/emergency-reports",null,"POST",body())).status,401);
    await json(await request("/security-alerts",100,"POST",body({targetService:"POLICE",alertType:"AGRESSION",locationName:"Repère fictif",accuracyMeters:null})),400);
  });
  await t.test("routing uses fictitious polygons and ignores a misleading city; idempotent retry retains one record",async()=>{
    const payload=body({city:"Korhogo",assignedBaseId:12,status:"ACKNOWLEDGED",photos:["data:image/png;base64,aGVsbG8="]});
    const first=await json(await request("/emergency-reports",100,"POST",payload),201);bouake=first.report;
    assert.equal(bouake.assignedBaseId,"11");assert.equal(bouake.status,"NEW");assert.equal(bouake.userId,"100");
    const again=await json(await request("/emergency-reports",100,"POST",payload),200);assert.equal(again.report.id,bouake.id);assert.equal(again.replayed,true);
    korhogo=(await json(await request("/emergency-reports",100,"POST",body({latitude:9.46,longitude:-5.63,pickupPointName:"REPÈRE KORHOGO FICTIF"})),201)).report;assert.equal(korhogo.assignedBaseId,"12");
  });
  await t.test("cross-center access denied consistently for list, guessed ID, photo, map, statistics, export and legacy mutations",async()=>{
    assert.equal((await json(await request("/incidents/medical",201),200)).length,1);
    assert.equal((await json(await request("/incidents/medical/map",201),200)).length,1);
    for(const user of [101,202,999,998])assert.equal((await request(`/incidents/medical/${bouake.id}`,user)).status,404);
    assert.equal((await request(`/incidents/medical/${bouake.id}/photos/0`,202)).status,404);
    assert.equal((await request(`/incidents/medical/${bouake.id}/photos/0`,201)).status,200);
    await json(await request(`/emergency-reports/${korhogo.id}/acknowledge`,201,"POST",{}),404);
    const stats=await json(await request("/incidents/medical/stats",201),200);assert.deepEqual(stats.map(x=>String(x.assigned_base_id)),["11"]);
    const csv=await(await request("/incidents/medical/export",201)).text();assert.ok(csv.includes("BOUAKÉ"));assert.ok(!csv.includes("KORHOGO"));
    const mine=await json(await request("/emergency-reports/mine?userId=101",100),200);assert.equal(mine.length,2);
    await json(await request("/incidents/medical",101),403);
    const local=await json(await request("/emergency-reports/local-alerts",201),200);assert.deepEqual(local.alerts.map(x=>x.id),[bouake.id]);
    assert.equal((await json(await request("/legacy-summary",201),200)).emergencyStats.total,1);
    assert.equal((await json(await request("/legacy-summary",999),200)).emergencyStats.total,0);
    assert.equal((await json(await request("/legacy-summary",1000),200)).emergencyStats.total,2);
    assert.equal((await json(await request("/legacy-user-actions/100",201),200)).emergencies.length,1);
    assert.equal((await json(await request("/legacy-user-actions/100",999),200)).emergencies.length,0);
  });
  await t.test("outside, ambiguous and inactive jurisdictions queue for explicit global coordination",async()=>{
    outside=(await json(await request("/emergency-reports",100,"POST",body({latitude:8,longitude:-6})),201)).report;
    inactive=(await json(await request("/emergency-reports",100,"POST",body({latitude:6,longitude:-4.5})),201)).report;
    await db.query("INSERT INTO emergency_zones(id,base_id,name,geometry,is_test) VALUES(9,13,'CHEVAUCHEMENT TEST FICTIF',$1,TRUE)",[JSON.stringify(square(-5.03,7.69))]);
    ambiguous=(await json(await request("/emergency-reports",100,"POST",body()),201)).report;
    for(const [r,reason] of [[outside,"OUTSIDE_ZONE"],[inactive,"INACTIVE_CENTER"],[ambiguous,"AMBIGUOUS_ZONE"]]){assert.equal(r.status,"PENDING_ASSIGNMENT");assert.equal(r.assignedBaseId,null);assert.equal(r.assignmentReason,reason);assert.equal((await request(`/incidents/medical/${r.id}`,201)).status,404);}
    const queue=await json(await request("/incidents/medical?queue=1",1000),200);assert.equal(queue.length,3);
    assert.equal((await json(await request("/incidents/medical?queue=1",1001),200)).length,0);
    await db.query("DELETE FROM emergency_zones WHERE id=9");
  });
  await t.test("notifications are scoped, generic, durable, and never acknowledge an incident",async()=>{
    const outbox=await db.query("SELECT user_id FROM incident_notification_outbox WHERE kind='medical' AND report_id=$1",[bouake.id]);
    assert.deepEqual(outbox.rows.map(r=>Number(r.user_id)).sort((a,b)=>a-b),[201,1000,1001]);
    const failed=[];await deliverIncidentNotifications({db,send:async(id)=>{if(Number(id)===201){failed.push(id);throw Error("TEST: provider unavailable");}return true;}});
    assert.ok(failed.length>0);
    assert.ok((await db.query("SELECT id FROM incident_notification_outbox WHERE user_id=201 AND delivered_at IS NULL")).rows.length>0);
    await db.query("UPDATE incident_notification_outbox SET next_attempt_at=NOW() WHERE delivered_at IS NULL");
    const delivered=[];await deliverIncidentNotifications({db,send:async(id,payload)=>{delivered.push({id,payload});return true;}});
    assert.ok(delivered.length>0);assert.ok(!JSON.stringify(delivered).includes("0102030405"));assert.ok(!JSON.stringify(delivered).includes("latitude"));
    assert.equal((await db.query("SELECT status FROM emergency_reports WHERE id=$1",[bouake.id])).rows[0].status,"NEW");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM incident_notification_outbox WHERE delivered_at IS NULL")).rows[0].n,0);
  });
  await t.test("status transitions record actor and date; skipped stages denied",async()=>{
    await json(await request(`/incidents/medical/${bouake.id}/status`,201,"PATCH",{status:"ON_SITE"}),409);
    await json(await request(`/emergency-reports/${bouake.id}/acknowledge`,201,"POST",{}),200);
    const detail=await json(await request(`/incidents/medical/${bouake.id}`,201),200);
    assert.equal(detail.history.at(-1).event,"STATUS");assert.equal(String(detail.history.at(-1).actor_id),"201");assert.ok(detail.history.at(-1).created_at);
  });
  await t.test("only explicitly entitled supervisors can authorize reinforcement, revoke it and transfer",async()=>{
    const transfer={mode:"REINFORCEMENT",targetBaseId:"12",reason:"Renfort de TEST FICTIF",authorizeTarget:true};
    await json(await request(`/incidents/medical/${bouake.id}/transfer`,201,"POST",transfer),403);
    await json(await request("/incidents/access/201",999,"PUT",{coordinateAll:false,coordinateBaseIds:[],supervisorBaseIds:["11"]}),200);
    await json(await request(`/incidents/medical/${bouake.id}/transfer`,201,"POST",{...transfer,authorizeTarget:false}),400);
    await json(await request(`/incidents/medical/${bouake.id}/transfer`,201,"POST",transfer),200);
    await json(await request(`/incidents/medical/${bouake.id}`,202),200);
    await json(await request(`/incidents/medical/${bouake.id}/revoke-reinforcement`,201,"POST",{targetBaseId:12,reason:"Fin du renfort fictif"}),200);
    await json(await request(`/incidents/medical/${bouake.id}`,202),404);
    // Revoked access also cancels pending notification delivery.
    const sends=[];await deliverIncidentNotifications({db,send:async(id)=>{sends.push(Number(id));return true;}});assert.ok(!sends.includes(202));
    await json(await request(`/incidents/medical/${bouake.id}/transfer`,201,"POST",{...transfer,mode:"TRANSFER"}),200);
    await json(await request(`/incidents/medical/${bouake.id}`,201),404);
    const destination=await json(await request(`/incidents/medical/${bouake.id}`,202),200);assert.equal(destination.assignedBaseId,"12");assert.equal(destination.status,"NEW");assert.equal(destination.handledBy,null);assert.equal(destination.history.at(-1).event,"TRANSFER");
    const source=await json(await request("/incidents/medical",201),200);assert.ok(!source.some(r=>r.id===bouake.id));
  });
  await t.test("coordination can assign the queue; scoped coordination cannot open another center",async()=>{
    await json(await request(`/incidents/medical/${korhogo.id}`,1001),404);
    await json(await request(`/incidents/medical/${outside.id}/transfer`,1000,"POST",{mode:"TRANSFER",targetBaseId:11,reason:"Affectation manuelle de TEST FICTIF",authorizeTarget:true}),200);
    assert.equal((await json(await request(`/incidents/medical/${outside.id}`,201),200)).assignedBaseId,"11");
  });
  await t.test("probable duplicates are flagged and retained; repeat throttling is independent of idempotency",async()=>{
    const duplicate=await json(await request("/emergency-reports",101,"POST",body()),201);assert.equal(duplicate.report.probableDuplicate,true);assert.ok(duplicate.warning);assert.ok(duplicate.report.id);
    await json(await request(`/incidents/medical/${duplicate.report.id}/status`,201,"PATCH",{status:"DUPLICATE"}),400);
    await json(await request(`/incidents/medical/${duplicate.report.id}/status`,201,"PATCH",{status:"DUPLICATE",reason:"Vérification fictive du doublon"}),200);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM emergency_reports WHERE id=$1",[duplicate.report.id])).rows[0].count,1);
    await db.query("UPDATE incident_policy SET max_reports_per_minute=1 WHERE id=1");
    const payload=body();await json(await request("/emergency-reports",998,"POST",payload),201);
    await json(await request("/emergency-reports",998,"POST",payload),200);
    await json(await request("/emergency-reports",998,"POST",body()),429);
    await db.query("UPDATE incident_policy SET max_reports_per_minute=30 WHERE id=1");
  });
  await t.test("security follows the same GPS, jurisdiction, ID and transition restrictions",async()=>{
    const security=(await json(await request("/security-alerts",100,"POST",body({targetService:"POLICE",alertType:"AGRESSION",locationName:"REPÈRE POLICE FICTIF"})),201)).alert;
    assert.equal(security.assignedBaseId,"21");await json(await request(`/incidents/security/${security.id}`,302),404);await json(await request(`/security-alerts/${security.id}`,302,"PATCH",{status:"ACKNOWLEDGED"}),404);
    for(const status of ["ACKNOWLEDGED","EN_ROUTE","ON_SITE","COMPLETED"])await json(await request(`/incidents/security/${security.id}/status`,301,"PATCH",{status}),200);
    const history=(await json(await request(`/incidents/security/${security.id}`,301),200)).history;assert.equal(history.length,5);
    assert.equal((await json(await request("/security-alerts/mine",100),200)).length,1);
  });
  await t.test("deactivating an assigned center requeues its active reports atomically and revokes agent access",async()=>{
    const fresh=(await json(await request("/emergency-reports",100,"POST",body({latitude:9.46,longitude:-5.63})),201)).report;
    await json(await request(`/incidents/medical/${fresh.id}/transfer`,1000,"POST",{mode:"TRANSFER",targetBaseId:13,reason:"Test fictif de désactivation",authorizeTarget:true}),200);
    await json(await request(`/incidents/medical/${fresh.id}`,203),200);
    await json(await request("/service-bases/13",999,"PUT",{name:"TEST FICTIF centre désactivé",serviceType:"SAMU",address:"Adresse fictive",city:"Ville fictive",latitude:7.69,longitude:-5.02,radiusKm:20,isActive:false}),200);
    await json(await request(`/incidents/medical/${fresh.id}`,203),404);
    const queued=await json(await request(`/incidents/medical/${fresh.id}`,1000),200);
    assert.equal(queued.status,"PENDING_ASSIGNMENT");assert.equal(queued.assignmentReason,"INACTIVE_CENTER");assert.equal(queued.history.at(-1).event,"CENTER_DEACTIVATED");
  });

  await t.test("configuration endpoints enforce admin rights, bounds and explicit fictitious zone labels",async()=>{
    const policy={maxAgeSeconds:30,maxAccuracyMeters:40,maxReportsPerMinute:30,duplicateWindowMinutes:15,duplicateDistanceMeters:150};
    await json(await request("/incidents/policy",100,"PUT",policy),403);
    await json(await request("/incidents/policy",999,"PUT",{...policy,maxAgeSeconds:0}),400);
    await json(await request("/incidents/policy",999,"PUT",policy),200);
    await json(await request("/emergency-reports",100,"POST",body({accuracyMeters:50})),400);
    await json(await request("/incidents/policy",999,"PUT",{...policy,maxAgeSeconds:60,maxAccuracyMeters:100}),200);
    const zone={baseId:11,name:"TEST FICTIF — périmètre sans valeur officielle",geometry:square(-3,8),isActive:true,isTest:true};
    await json(await request("/incidents/zones",100,"POST",zone),403);
    await json(await request("/incidents/zones",999,"POST",{...zone,name:"Zone de TEST FICTIVE additionnelle"}),201);
    await json(await request("/incidents/zones",999,"POST",{...zone,name:"Nom ambigu"}),400);
    const configured=await json(await request("/incidents/zones",999,"POST",zone),201);assert.equal(configured.is_test,true);
    await json(await request(`/incidents/zones/${configured.id}`,999,"PUT",{...zone,isActive:false}),200);
  });

  await t.test("map selection: admin only, validation, atomic save, retry deduplication and inactive base rejection",async()=>{
    const payload={baseId:11,isTest:true,zones:[{name:"TEST FICTIF sélection A",geometry:square(-2,9)},{name:"TEST FICTIF sélection B",geometry:square(-2.2,9)}]};
    await json(await request("/incidents/zones/selection",100,"POST",payload),403);
    assert.equal((await request("/incidents/zones/selection",null,"POST",payload)).status,401);
    await json(await request("/incidents/zones/selection",999,"POST",{...payload,zones:[payload.zones[0],{name:"TEST FICTIF invalide",geometry:{type:"Polygon",coordinates:[]}}]}),400);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM emergency_zones WHERE name LIKE 'TEST FICTIF sélection%' ")).rows[0].n,0);
    await json(await request("/incidents/zones/selection",999,"POST",{...payload,baseId:13}),400);
    const saved=await json(await request("/incidents/zones/selection",999,"POST",payload),201);
    assert.equal(saved.zones.length,2);assert.ok(saved.zones.every(z=>String(z.base_id)==="11"&&z.is_test&&z.is_active));
    const replay=await json(await request("/incidents/zones/selection",999,"POST",payload),201);
    assert.deepEqual(replay.zones.map(z=>z.id),saved.zones.map(z=>z.id));
    const routed=(await json(await request("/emergency-reports",1001,"POST",body({longitude:-2,latitude:9})),201)).report;
    assert.equal(routed.assignedBaseId,"11");
    await json(await request(`/incidents/medical/${routed.id}`,202),404);
    await db.query("ALTER TABLE emergency_zones ADD CONSTRAINT fixture_map_fail CHECK(name <> 'TEST FICTIF échec transaction')");
    try{
      await json(await request("/incidents/zones/selection",999,"POST",{...payload,zones:[{name:"TEST FICTIF rollback sélection",geometry:square(-2.4,9)},{name:"TEST FICTIF échec transaction",geometry:square(-2.6,9)}]}),500);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM emergency_zones WHERE name='TEST FICTIF rollback sélection'")).rows[0].n,0);
    }finally{await db.query("ALTER TABLE emergency_zones DROP CONSTRAINT fixture_map_fail");}
  });

  await t.test("production routing never uses test-only fictitious polygons",async()=>{
    process.env.NODE_ENV="production";
    try {
      const result=await json(await request("/emergency-reports",100,"POST",body()),201);
      assert.equal(result.report.assignedBaseId,null);assert.equal(result.report.assignmentReason,"OUTSIDE_ZONE");
    }finally{process.env.NODE_ENV="test";}
  });

});
