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

function setupCsv(response){
  const storage=new Map([['sante_web_token','session'],['sante_web_user','{}']]),redirects=[],calls=[],exports={};
  vm.runInNewContext(code,{exports,process:{env:{}},Blob,fetch:async(url,options)=>{calls.push({url,options});return response;},window:{location:{pathname:'/dashboard/emergency-alerts',replace:path=>redirects.push(path)}},localStorage:{getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)}});
  return {...exports,storage,redirects,calls};
}
test('an expired session during a CSV export clears the session and returns to login',async()=>{
  const app=setupCsv({ok:false,status:401,headers:{get:()=> 'application/json'},json:async()=>({message:'Token invalide'})});
  await assert.rejects(app.apiFetch('/incidents/medical/export',{token:'session',responseType:'blob'}),/Token invalide/);
  assert.equal(app.storage.has('sante_web_token'),false);assert.deepEqual(app.redirects,['/login']);
});
test('authorized CSV exports return a blob with bearer authorization and no browser cache',async()=>{
  const data=new Blob(['id;statut\n1;NEW']);
  const app=setupCsv({ok:true,status:200,headers:{get:()=> 'text/csv'},blob:async()=>data});
  assert.equal(await app.apiFetch('/incidents/medical/export',{token:'session',responseType:'blob'}),data);
  assert.equal(app.calls[0].options.headers.Authorization,'Bearer session');assert.equal(app.calls[0].options.cache,'no-store');assert.deepEqual(app.redirects,[]);
});
