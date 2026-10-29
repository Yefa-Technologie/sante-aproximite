const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const code = babel.transformSync(fs.readFileSync(__dirname + '/client.js', 'utf8'), { configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
const TOKEN = 'sante_aproxmite_token';
const REFRESH = 'sante_aproxmite_refresh_token';
function setup(responses, refresh = 'refresh') {
  const storage = new Map([[TOKEN, 'expired'], [REFRESH, refresh], ['sante_aproxmite_user', '{}']]);
  const events = []; const calls = [];
  const mockStorage = { getItem: async k => storage.get(k) || null, multiSet: async entries => entries.forEach(([k,v])=>storage.set(k,v)), multiRemove: async keys => keys.forEach(k=>storage.delete(k)), setItem: async(k,v)=>storage.set(k,v) };
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: {} }, AbortController, setTimeout, clearTimeout,
    require: name => name.includes('async-storage') ? mockStorage : {},
    fetch: async (url, options) => { calls.push({url,options}); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('Unexpected request'); return { ok: next.status < 400, status: next.status, text: async()=>JSON.stringify(next.body || {}) }; }
  });
  exports.subscribeSession(event=>events.push(event));
  return { ...exports, storage, events, calls };
}
test('expired profile and rejected refresh clear stored session and notify login screen', async()=>{
  const app=setup([{status:401},{status:401}]);
  await assert.rejects(app.apiFetch('/auth/profile',{token:'expired'}));
  assert.equal(app.storage.has(TOKEN),false); assert.equal(app.events[0].expired,true);
});
test('missing refresh token returns to login', async()=>{
  const app=setup([{status:401}], '');
  await assert.rejects(app.apiFetch('/centers',{token:'expired'}));
  assert.equal(app.events[0].expired,true);
});
test('valid refresh retries with new token and updates in-memory session', async()=>{
  const app=setup([{status:401},{status:200,body:{token:'new',refreshToken:'next',user:{id:'1'}}},{status:200,body:{ok:true}}]);
  const result=await app.apiFetch('/auth/profile',{token:'expired'});
  assert.equal(result.ok,true); assert.equal(app.storage.get(TOKEN),'new');
  assert.equal(app.events[0].payload.token,'new'); assert.equal(app.calls[2].options.headers.Authorization,'Bearer new');
});
test('network failure during refresh preserves the session', async()=>{
  const app=setup([{status:401},new Error('Network request failed')]);
  await assert.rejects(app.apiFetch('/centers',{token:'expired'}));
  assert.equal(app.storage.get(TOKEN),'expired'); assert.equal(app.events.length,0);
});
test('invalid credentials on login do not expire an existing session', async()=>{
  const app=setup([{status:401}]);
  await assert.rejects(app.apiFetch('/auth/login',{method:'POST',body:{}}));
  assert.equal(app.events.length,0);
});
test('a renewed token rejected again also returns to login', async()=>{
  const app=setup([{status:401},{status:200,body:{token:'new'}},{status:401}]);
  await assert.rejects(app.apiFetch('/centers',{token:'expired'}));
  assert.equal(app.storage.has(TOKEN),false); assert.equal(app.events.at(-1).expired,true);
});

test('live emergency alerts never fall back to an outdated cached result', async()=>{
  const app=setup([new Error('Network request failed')]);
  app.storage.set('sante_aproxmite_cache_expired_%2Femergency-reports%2Flocal-alerts',JSON.stringify({savedAt:Date.now(),data:{alerts:[{id:'old'}]}}));
  await assert.rejects(app.apiFetch('/emergency-reports/local-alerts',{token:'expired',cache:false,queueOffline:false}));
});
