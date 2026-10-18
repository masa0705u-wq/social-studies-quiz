import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('home and maintenance preview never poll the game API',async()=>{
 for(const search of ['', '?view=teacher','?view=student','?view=projector']){
  const calls=[],intervals=[],elements=new Map();for(const id of ['app','dialog','toast','dialog-content'])elements.set(id,{innerHTML:'',style:{},open:false});
  const ctx=vm.createContext({console,URL,URLSearchParams,encodeURIComponent,crypto,Map,Set,structuredClone,location:{search,hash:'',pathname:'/social-studies-quiz/',origin:'https://example.invalid'},history:{replaceState(){}},localStorage:{getItem(){return null},setItem(){},removeItem(){}},document:{baseURI:'https://example.invalid/social-studies-quiz/',getElementById(id){return elements.get(id)},querySelectorAll(){return[]},addEventListener(){},activeElement:null},window:{addEventListener(){}},setInterval(fn){intervals.push(fn);return intervals.length},setTimeout(){},clearTimeout(){},fetch:async url=>{calls.push(String(url));return{json:async()=>({apiBase:'https://server.invalid',backendReady:search?false:true})}}});
  await vm.runInContext(readFileSync(new URL('../public/quiz-app.js',import.meta.url),'utf8'),ctx);
  await intervals[0]();assert.equal(calls.filter(url=>url.includes('/api/quiz')).length,0,search||'home');
 }
});
