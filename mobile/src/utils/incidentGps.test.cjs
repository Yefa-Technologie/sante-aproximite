const test=require('node:test'),assert=require('node:assert/strict');
const {validateFix,captureIncidentPosition,newRequestId}=require('./incidentGps.cjs');
const policy={maxAgeSeconds:60,maxAccuracyMeters:100};
const fix=()=>({timestamp:Date.now(),coords:{latitude:7.69,longitude:-5.03,accuracy:20}});
const location=(overrides={})=>({Accuracy:{Highest:6},requestForegroundPermissionsAsync:async()=>({status:'granted'}),hasServicesEnabledAsync:async()=>true,getCurrentPositionAsync:async()=>fix(),...overrides});
test('GPS refuses denied permission and disabled services with retry instructions',async()=>{
 await assert.rejects(captureIncidentPosition(location({requestForegroundPermissionsAsync:async()=>({status:'denied'})}),policy),/paramètres/);
 await assert.rejects(captureIncidentPosition(location({hasServicesEnabledAsync:async()=>false}),policy),/GPS désactivé/);
});
test('GPS refuses stale, missing, imprecise and simulated fixes',()=>{
 const current=fix();
 for(const value of [null,{...current,timestamp:Date.now()-60000},{...current,coords:{...current.coords,accuracy:null}},{...current,coords:{...current.coords,accuracy:101}},{...current,mocked:true}])assert.throws(()=>validateFix(value,policy));
});
test('every acquisition requests a new precise fix, and configured thresholds apply',async()=>{
 let requests=0;const gps=location({getCurrentPositionAsync:async options=>{assert.equal(options.accuracy,6);requests++;return fix();}});
 const first=await captureIncidentPosition(gps,policy);await captureIncidentPosition(gps,policy);
 assert.equal(requests,2);assert.equal(first.latitude,7.69);assert.equal(typeof first.locationTimestamp,'number');
 await assert.rejects(captureIncidentPosition(gps,{maxAgeSeconds:60,maxAccuracyMeters:10}),/imprécise/);
 assert.notEqual(newRequestId(),newRequestId());
});
