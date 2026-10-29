// GeoJSON coordinates are [longitude, latitude]. No jurisdiction is bundled here.
const finite = (x) => typeof x === "number" && Number.isFinite(x);
export const validPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(finite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
function onSegment(p, a, b) {
  const cross = (p[1]-a[1])*(b[0]-a[0])-(p[0]-a[0])*(b[1]-a[1]);
  return Math.abs(cross) < 1e-10 && p[0]>=Math.min(a[0],b[0])-1e-10 && p[0]<=Math.max(a[0],b[0])+1e-10 && p[1]>=Math.min(a[1],b[1])-1e-10 && p[1]<=Math.max(a[1],b[1])+1e-10;
}
function orientation(a,b,c) { return Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])); }
function intersects(a,b,c,d) {
  return (orientation(a,b,c)!==orientation(a,b,d) && orientation(c,d,a)!==orientation(c,d,b)) || onSegment(c,a,b) || onSegment(d,a,b) || onSegment(a,c,d) || onSegment(b,c,d);
}
export function validatePolygon(geometry) {
  if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length || geometry.coordinates.length>20) throw new Error("Un périmètre GeoJSON Polygon valide est obligatoire.");
  let count=0;
  for (const ring of geometry.coordinates) {
    if (!Array.isArray(ring) || ring.length<4 || (count+=ring.length)>2000 || !ring.every(validPoint) || JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1))) throw new Error("Chaque contour doit être fermé et contenir au moins trois sommets GPS valides (2000 points maximum).");
    if(Math.max(...ring.map(p=>p[0]))-Math.min(...ring.map(p=>p[0]))>180) throw new Error("Les périmètres traversant l’antiméridien doivent être divisés en zones distinctes.");
    let area=0;
    for (let i=0;i<ring.length-1;i++) {
      if (JSON.stringify(ring[i])===JSON.stringify(ring[i+1])) throw new Error("Sommets consécutifs identiques.");
      area+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
      for(let j=i+2;j<ring.length-1;j++) if (!(i===0 && j===ring.length-2) && intersects(ring[i],ring[i+1],ring[j],ring[j+1])) throw new Error("Le contour se croise lui-même.");
    }
    if(Math.abs(area)<1e-12) throw new Error("Le périmètre doit délimiter une surface.");
  }
  const rings=geometry.coordinates;
  for(let h=1;h<rings.length;h++) {
    if(ringPosition(rings[h][0],rings[0])!==1) throw new Error("Les exclusions doivent être à l’intérieur du contour principal.");
    for(let r=0;r<h;r++) {
      for(let i=0;i<rings[h].length-1;i++) for(let j=0;j<rings[r].length-1;j++) if(intersects(rings[h][i],rings[h][i+1],rings[r][j],rings[r][j+1])) throw new Error("Les contours ne doivent pas se croiser ni se toucher.");
      if(r>0 && (ringPosition(rings[h][0],rings[r])===1 || ringPosition(rings[r][0],rings[h])===1)) throw new Error("Exclusions imbriquées interdites.");
    }
  }
  return geometry;
}
function ringPosition(p, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    if(onSegment(p,ring[j],ring[i])) return 0;
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if((yi>p[1])!==(yj>p[1]) && p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside?1:-1;
}
export function containsPoint(geometry, point) {
  if(ringPosition(point,geometry.coordinates[0])===-1) return false;
  return !geometry.coordinates.slice(1).some(ring=>ringPosition(point,ring)===1);
}
export function chooseAssignment(zones, point) {
  const matches=zones.filter(z=>z.is_active && containsPoint(z.geometry,point));
  const ids=[...new Set(matches.map(z=>String(z.base_id)))];
  if(!ids.length) return {baseId:null,reason:"OUTSIDE_ZONE"};
  if(ids.length>1) return {baseId:null,reason:"AMBIGUOUS_ZONE"};
  if(matches.some(z=>!z.base_active || z.approval_status!=="APPROVED")) return {baseId:null,reason:"INACTIVE_CENTER"};
  return {baseId:ids[0],reason:"ZONE_MATCH"};
}
