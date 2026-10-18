// Explicitly local-only: never sends fixture questions or mock authentication to a hosted Site.
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:8894';
assert.equal(new URL(origin).hostname,'127.0.0.1','This smoke test is restricted to local development.');
async function call(action,input={},teacher=true,requestOrigin=origin){
 const response=await fetch(origin+'/api/quiz',{method:'POST',headers:{'Content-Type':'application/json','Origin':requestOrigin,...(teacher?{'Cookie':'__sites_local_auth=1'}:{})},body:JSON.stringify({action,input})});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={ok:false,message:text}}return{status:response.status,...data};
}
async function ok(action,input={}){const r=await call(action,input);assert.equal(r.ok,true,action+': '+r.message);return r.result;}
for(const action of ['catalog','settings','teacher.me','backups','backupStatus','restoreTest','uploadFile'])assert.equal((await call(action,{},false)).status,403,action);
assert.equal((await call('catalog',{},true,'https://foreign.invalid')).status,403);
const year=await ok('createYear',{label:'HTTP通し検証の架空年度',startDate:'2026-04-01',endDate:'2027-03-31',classes:[{name:'HTTP試験クラス',groupCount:8}]});
const q=await ok('saveQuestion',{title:'架空HTTP試験',body:'検証用の文字 TEST を送信してください。',primaryAnswer:'TEST',acceptedAnswers:['test'],field:'civics',unit:'架空試験',difficulty:'easy',puzzleType:'fixture',hintText:'Tで始まる4文字です。',explanation:'検証用の解説1\n検証用の解説2',sources:[{title:'架空の検証資料',publisher:'ローカル検証',retrievedAt:'2026-10-18',unverified:true}]});
const image=await ok('uploadFile',{name:'local-fixture.png',licenseNotes:'検証用自作データ',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lmcAAAAASUVORK5CYII='});
await ok('attachImage',{questionId:q.questionId,command:'attach',fileId:image.id,altText:'ローカル検証画像'});await ok('questionAction',{id:q.questionId,command:'approve'});
await ok('settings',{openingSeconds:0,rankingSeconds:0});
const created=await ok('createGame',{yearId:year.id,classId:year.classes[0].id,count:1,questionIds:[q.questionId],fields:[],units:[],alternativeApproved:true,isSimulation:true});const gameId=created.game.id;
await ok('command',{gameId,command:'open'});const sessions=[];
for(const group of created.game.groups){const r=await call('join',{code:created.joinCode,groupId:group.id},false);assert.equal(r.ok,true);sessions.push(r.result);}
assert.equal((await call('join',{code:created.joinCode,groupId:created.game.groups[0].id},false)).status,409);
let state=await ok('command',{gameId,command:'start'});
const receipts=await Promise.all(sessions.map((s,i)=>call('submit',{...s,roundId:state.round.id,answer:i<6?'TEST':'wrong',requestId:'local-'+i},false)));assert.ok(receipts.every(r=>r.ok&&r.result.accepted));
const retry=await call('submit',{...sessions[0],roundId:state.round.id,answer:'TEST',requestId:'local-0'},false);assert.equal(retry.result.responseId,receipts[0].result.responseId);
const student=await call('state',sessions[0],false);assert.equal(student.result.round.primaryAnswer,undefined);assert.equal(student.result.responses,undefined);
const projector=await call('projectorState',{gameId,token:created.projectorToken},false);assert.equal(projector.result.round.primaryAnswer,undefined);
const bytes=await call('image',{gameId,token:created.projectorToken,fileId:image.id},false);assert.equal(bytes.ok,true);assert.ok(bytes.result.data.startsWith('data:image/png;base64,'));
assert.equal((await call('image',{gameId,token:'bad',fileId:image.id},false)).status,403);
await ok('command',{gameId,command:'close'});state=await ok('command',{gameId,command:'reveal'});assert.equal(state.round.primaryAnswer,'TEST');
state=await ok('command',{gameId,command:'next'});if(state.status==='ranking')state=await ok('command',{gameId,command:'skipRanking'});assert.equal(state.status,'ended');assert.equal(state.scores.filter(s=>s.rank===1).length,6);
assert.ok(!(await ok('results')).some(g=>g.id===gameId));
const backup=await ok('backup');assert.equal(backup.status,'complete');const restored=await ok('restoreTest',{id:backup.id});assert.equal(restored.productionUnchanged,true);assert.ok(restored.events>=8);assert.ok(restored.files>=1);await ok('backupStatus');
console.log(JSON.stringify({localOnly:true,groups:8,concurrentAnswers:8,idempotentRetry:true,teacherAndOriginProtection:true,projectorImageTokenProtection:true,unrevealedAnswersHidden:true,sharedWinners:6,simulationExcluded:true,finalStatus:state.status,backup:'complete',restoreVerified:true}));
