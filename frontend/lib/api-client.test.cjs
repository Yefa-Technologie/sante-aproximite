const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(__dirname + '/api-client.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function setup({status=401, body={message:'Token invalide'}, network=false, storedToken='expired'}={}) {
  const storage = new Map([['sante_web_token',storedToken],['sante_web_user','{}']]);
  const redirects=[]; const exports={};
  vm.runInNewContext(code, { exports, process:{env:{NEXT_PUBLIC_API_URL:'https://sante-aproximite.yefa-technologie.org/api'}},
    localStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    window:{location:{pathname:'/dashboard',replace:path=>redirects.push(path)}},
    fetch:async()=>{if(network)throw new Error('offline');return {ok:status<400,status,headers:{get:()=> 'application/json'},json:async()=>body};}
  });
  return {...exports,storage,redirects};
}
test('401 with a backend message clears session and redirects to login',async()=>{
  const api=setup(); await assert.rejects(api.apiFetch('/centers',{token:'expired'}),e=>e.status===401);
  assert.deepEqual(api.redirects,['/login']); assert.equal(api.storage.has('sante_web_token'),false); assert.equal(api.storage.has('sante_web_user'),false);
});
test('401 without a message also redirects',async()=>{
  const api=setup({body:{}});await assert.rejects(api.apiFetch('/auth/profile',{token:'expired'}));assert.deepEqual(api.redirects,['/login']);
});
test('invalid login credentials do not redirect or clear another session',async()=>{
  const api=setup();await assert.rejects(api.apiFetch('/auth/login',{method:'POST',body:{}}));assert.equal(api.redirects.length,0);assert.equal(api.storage.get('sante_web_token'),'expired');
});
test('a late response for an old token does not clear a newer login',async()=>{
  const api=setup({storedToken:'new'});await assert.rejects(api.apiFetch('/centers',{token:'expired'}));assert.equal(api.redirects.length,0);assert.equal(api.storage.get('sante_web_token'),'new');
});
test('network errors and forbidden actions preserve the session',async()=>{
  for(const options of [{network:true},{status:403}]){const api=setup(options);await assert.rejects(api.apiFetch('/centers',{token:'expired'}));assert.equal(api.redirects.length,0);assert.equal(api.storage.get('sante_web_token'),'expired');}
});
