import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEmergencyRouter } from './emergencyRoutes.js';
import { pool } from '../config/db.js';

async function setup(t) {
  const queries = [];
  const original = pool.query;
  pool.query = async (sql, params) => {
    queries.push({sql,params});
    return { rows: sql.includes('INSERT INTO emergency_reports') ? [{ id: 7, user_id: params[0], target_service: params[1], status: 'NEW' }] : [] };
  };
  t.after(()=>{pool.query=original;});
  const app=express(); app.use(express.json());
  app.use('/emergency',createEmergencyRouter({auth:(req,res,next)=>{
    if(!req.headers['x-role'])return res.sendStatus(401);
    req.user={id:'12',role:req.headers['x-role'],roles:[req.headers['x-role']]};next();
  }}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.closeAllConnections();server.close();});
  return {queries,request:(path,method='GET',body,role='USER')=>fetch(`http://127.0.0.1:${server.address().port}/emergency${path}`,{method,headers:{'Content-Type':'application/json',...(role?{'x-role':role}:{})},...(body?{body:JSON.stringify(body)}:{})})};
}

test('a connected public user can report an emergency with their own identity',async t=>{
  const {request,queries}=await setup(t);
  const r=await request('/','POST',{userId:999,targetService:'SAMU',phoneNumber:'0102030405',emergencyType:'Malaise',pickupPointName:'Point de test',description:'Description de verification',latitude:5.3,longitude:-4});
  assert.equal(r.status,201);assert.equal((await r.json()).report.userId,'12');assert.equal(queries[0].params[0],12);
});

test('public users can only load their own report history',async t=>{
  const {request,queries}=await setup(t);
  assert.equal((await request('/mine?userId=999')).status,200);
  assert.match(queries[0].sql,/WHERE er.user_id = \$1/);assert.deepEqual(queries[0].params,[12]);
});

test('all operational endpoints remain forbidden for public users',async t=>{
  const {request,queries}=await setup(t);
  for(const [path,method] of [['/','GET'],['/7/acknowledge','POST'],['/7/progress','PATCH'],['/bases','POST'],['/bases','GET']])assert.equal((await request(path,method)).status,403);
  assert.equal(queries.length,0);
});

test('anonymous reports and history are rejected, while responders retain access',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/','POST',{},'')).status,401);
  assert.equal((await request('/mine','GET',undefined,'')).status,401);
  assert.equal((await request('/','GET',undefined,'SAMU')).status,200);
  assert.equal((await request('/','GET',undefined,'SAPEUR_POMPIER')).status,200);
});
