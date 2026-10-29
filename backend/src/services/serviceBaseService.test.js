import test from "node:test";
import assert from "node:assert/strict";
import { resolveServiceBases, baseScopeSql, writeServiceBase } from "./serviceBaseService.js";
const admin={id:"1",roles:["DEVELOPER"]};
test("service accounts require an active base matching each service role",async()=>{
  const db={query:async()=>({rows:[{id:4,service_type:"SAMU"}]})};
  await assert.rejects(resolveServiceBases(db,admin,["SAMU"],{}),/obligatoire/);
  await assert.rejects(resolveServiceBases(db,admin,["SAPEUR_POMPIER"],{serviceBases:{SAPEUR_POMPIER:"4"}}),/ne correspond pas/);
  assert.deepEqual(await resolveServiceBases(db,admin,["SAMU"],{serviceBases:{SAMU:"4"}}),{SAMU:4});
  await assert.rejects(resolveServiceBases({query:async()=>({rows:[]})},admin,["SAMU"],{serviceBases:{SAMU:"4"}}),/inactive/);
});
test("a responder cannot assign an account to another base",async()=>{
  const db={query:async(sql)=>({rows:sql.includes("FOR SHARE")?[{id:4,service_type:"SAMU"}]:[]})};
  await assert.rejects(resolveServiceBases(db,{id:2,role:"SAMU"},["SAMU"],{serviceBases:{SAMU:4}}),/propre base/);
});
test("all operational scopes require an assignment or an explicit coordination grant",()=>{
  for(const role of ["USER","DEVELOPER","NATIONAL","POLICE"]){const p=[];const sql=baseScopeSql("r",{id:1,role},p,["SAMU","SAPEUR_POMPIER"]);assert.match(sql,/incident_access_roles/);assert.match(sql,/assigned_base_id/);assert.deepEqual(p,[1,[]]);assert.doesNotMatch(sql,/radius_km/);}
});

test("base creation is denied to public and operational accounts",async()=>{
  for(const role of ["USER","SAMU","POLICE"]){let status;const res={status(s){status=s;return this;},json(){}};await writeServiceBase({user:{id:1,role}},res);assert.equal(status,403);}
});
