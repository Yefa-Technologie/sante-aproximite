// Based only on the persistent base ID, so filtering or sorting cannot change it.
export function baseMapColor(id: string | number): string {
  const key = String(id);
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const value = /^\d+$/.test(key) ? BigInt(key) : BigInt(hash);
  const hue = Number((value * BigInt(137508)) % BigInt(360000)) / 1000;
  return `hsl(${hue}, 72%, 38%)`;
}
