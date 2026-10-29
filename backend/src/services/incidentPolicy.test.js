import test from "node:test";
import assert from "node:assert/strict";
import {validateIncidentLocation} from "./incidentPolicy.js";
import {validatePolygon,containsPoint,chooseAssignment} from "./incidentGeometry.js";
const policy={maxAgeSeconds:60,maxAccuracyMeters:100},now=1800000000000;
const position={latitude:7.69,longitude:-5.03,locationTimestamp:now-1000,accuracyMeters:20,presenceConfirmed:true};
test("GPS: strict coordinates, presence, freshness, accuracy, future and known simulation checks",()=>{
  assert.equal(validateIncidentLocation(position,policy,now).accuracy,20);
  for(const change of [{latitude:null},{longitude:"-5"},{latitude:91},{presenceConfirmed:false},{locationTimestamp:null},{locationTimestamp:now-60000},{locationTimestamp:now+10000},{accuracyMeters:null},{accuracyMeters:101},{accuracyMeters:-1},{locationMocked:true}])assert.throws(()=>validateIncidentLocation({...position,...change},policy,now));
  assert.doesNotThrow(()=>validateIncidentLocation({...position,accuracyMeters:100},policy,now));
  assert.throws(()=>validateIncidentLocation({...position,accuracyMeters:51},{maxAgeSeconds:10,maxAccuracyMeters:50},now));
});
// All polygons below are intentionally FICTITIOUS squares, never official boundaries.
const fictiveSquare=(lon,lat)=>({type:"Polygon",coordinates:[[[lon-.01,lat-.01],[lon+.01,lat-.01],[lon+.01,lat+.01],[lon-.01,lat+.01],[lon-.01,lat-.01]]]});
const zone=(id,geometry,extra={})=>({base_id:id,geometry,is_active:true,base_active:true,approval_status:"APPROVED",...extra});
test("fictitious Korhogo/Bouaké zones route by coordinates, not by a city string or radius",()=>{
 const zones=[zone(1,fictiveSquare(-5.63,9.46)),zone(2,fictiveSquare(-5.03,7.69))];
 for(const z of zones)validatePolygon(z.geometry);
 assert.deepEqual(chooseAssignment(zones,[-5.63,9.46]),{baseId:"1",reason:"ZONE_MATCH"});
 assert.deepEqual(chooseAssignment(zones,[-5.03,7.69]),{baseId:"2",reason:"ZONE_MATCH"});
 assert.equal(chooseAssignment(zones,[-4,6]).reason,"OUTSIDE_ZONE");
 assert.equal(chooseAssignment([...zones,zone(3,fictiveSquare(-5.03,7.69))],[-5.03,7.69]).reason,"AMBIGUOUS_ZONE");
 assert.equal(chooseAssignment([zone(1,zones[0].geometry,{base_active:false})],[-5.63,9.46]).reason,"INACTIVE_CENTER");
 assert.equal(chooseAssignment([zone(1,zones[0].geometry,{is_active:false})],[-5.63,9.46]).reason,"OUTSIDE_ZONE");
});
test("zone boundaries are conservative, holes are excluded, invalid or crossed polygons are rejected",()=>{
 const polygon={type:"Polygon",coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]};
 validatePolygon(polygon);assert.equal(containsPoint(polygon,[1.5,1.5]),false);assert.equal(containsPoint(polygon,[0,2]),true);
 assert.throws(()=>validatePolygon({type:"Polygon",coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}));
 assert.throws(()=>validatePolygon({type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,1]]]}));
 assert.throws(()=>validatePolygon({type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]],[[2,2],[3,2],[3,3],[2,2]]]}));
});
