import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Store} from '../lib/quiz/store.mjs';
import {Engine,freshCatalog} from '../lib/quiz/engine.mjs';
import {Files} from '../lib/quiz/files.mjs';
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../drizzle/0000_jittery_giant_man.sql',import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;let bindings=[];return {bind(...values){bindings=values;return this;},async first(){return db.prepare(sql).get(...bindings)||null;},async all(){return{results:db.prepare(sql).all(...bindings)};},run(){const result=db.prepare(sql).run(...bindings);return{meta:{changes:Number(result.changes)}};}};}
 async batch(statements){this.db.exec('BEGIN');try{const results=statements.map(s=>s.run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
class Bucket{
 constructor(){this.data=new Map();}
 async put(key,value,opts={}){let bytes;if(typeof value==='string')bytes=new TextEncoder().encode(value);else if(value instanceof ArrayBuffer)bytes=new Uint8Array(value);else bytes=value;this.data.set(key,{bytes:new Uint8Array(bytes),httpMetadata:opts.httpMetadata||{}});}
 async get(key){const v=this.data.get(key);if(!v)return null;return{arrayBuffer:async()=>v.bytes.slice().buffer,text:async()=>new TextDecoder().decode(v.bytes),httpMetadata:v.httpMetadata};}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.data.delete(key);}
 async list({prefix=''}){return{objects:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}
}
const question=(i,d='easy')=>({title:'架空の試験問題'+i,body:'架空の試験問題'+i+'の表示を確認してください。',primaryAnswer:'TEST'+i,acceptedAnswers:['試験'+i],difficulty:d,field:['geography','history','civics'][i%3],unit:'架空試験',puzzleType:'fixture',hintText:'試験用のヒントです',explanation:'第一段階\n第二段階',sources:[{title:'架空の検証資料',publisher:'テスト',retrievedAt:'2026-10-18',unverified:true}]});
async function fixture({groups=8,count=5}={}){const store=new Store(new D1());let time=1000000;const engine=new Engine(store,{clock:()=>time});const c=freshCatalog();c.settings.openingSeconds=3;c.settings.rankingSeconds=8;await store.put('catalog',c);const year=await engine.createYear('teacher',{label:'架空年度',startDate:'2026-04-01',endDate:'2027-03-31',classes:[{name:'架空クラス',groupCount:groups}]});for(let i=0;i<count;i++){const q=await engine.saveQuestion('teacher',question(i,['easy','easy','standard','standard','hard'][i%5]));await engine.questionAction('teacher',{id:q.questionId,command:'approve'});}const catalog=await engine.catalog();const input={yearId:year.id,classId:year.classes[0].id,count,questionIds:catalog.questions.map(q=>q.questionId),fields:[],units:[],alternativeApproved:true};const created=await engine.createGame('teacher',input);const id=created.game.id;const raw=await engine.teacherGame(id);await store.put('game:'+id,{...raw,isSimulation:true});await engine.command('teacher',{gameId:id,command:'open'});const sessions=[];for(const group of created.game.groups)sessions.push(await engine.join({code:created.joinCode,groupId:group.id}));return {store,engine,id,created,sessions,catalog,setTime:n=>time=n,addTime:n=>time+=n,time:()=>time};}
async function start(f){await f.engine.command('teacher',{gameId:f.id,command:'start'});f.addTime(3000);return f.engine.state({gameId:f.id},'teacher');}
function send(f,session,roundId,answer,id=crypto.randomUUID()){return f.engine.submit({...session,roundId,answer,requestId:id});}
test('T20 import atomic validation and edits reset approval, immutable IDs, archive retained',async()=>{
 const store=new Store(new D1()),engine=new Engine(store);
 await assert.rejects(()=>engine.importQuestions('t',[question(1),{title:'invalid'}]));assert.equal((await engine.catalog()).questions.length,0);
 const added=await engine.importQuestions('t',[{...question(1),approvalStatus:'approved',questionId:'injected'}]);assert.equal(added[0].approvalStatus,'unreviewed');assert.notEqual(added[0].questionId,'injected');
 const approved=await engine.questionAction('t',{id:added[0].questionId,command:'approve'});const edited=await engine.saveQuestion('t',{...approved,title:'変更'});assert.equal(edited.questionId,approved.questionId);assert.equal(edited.approvalStatus,'unreviewed');assert.equal(edited.sources[0].sourceId,approved.sources[0].sourceId);
 const copy=await engine.questionAction('t',{id:edited.questionId,command:'duplicate'});assert.notEqual(copy.questionId,edited.questionId);assert.equal(copy.approvalStatus,'unreviewed');
 await engine.questionAction('t',{id:edited.questionId,command:'archive'});assert.equal((await engine.catalog()).questions.find(q=>q.questionId===edited.questionId).archived,true);const archivedEdit=await engine.saveQuestion('t',{...edited,title:'保管中の編集'});assert.equal(archivedEdit.archived,true);
});
test('T10 persistent request idempotency survives deadline and rejects duplicate participation',async()=>{
 const f=await fixture({count:1});await assert.rejects(()=>f.engine.join({code:f.created.joinCode,groupId:f.sessions[0].groupId}),e=>e.code==='GROUP_TAKEN');const state=await start(f),session=f.sessions[0];
 const first=await send(f,session,state.round.id,'TEST0','same-request');f.addTime(70000);const retry=await send(f,session,state.round.id,'TEST0','same-request');assert.deepEqual(retry,first);
 const late=await send(f,session,state.round.id,'TEST0','new-request');assert.equal(late.accepted,false);const events=await f.store.events(f.id);assert.equal(events.length,2);
 assert.equal((await f.engine.teacherGame(f.id)).rounds[0].responses[session.groupId].count,1);
});
test('T11/T12 server deadline, pause/resume, extension, hint and final-answer rules',async()=>{
 const f=await fixture({count:1});let s=await start(f);await send(f,f.sessions[0],s.round.id,'TEST0');f.addTime(10000);await f.engine.command('teacher',{gameId:f.id,command:'pause'});assert.equal((await send(f,f.sessions[1],s.round.id,'TEST0')).accepted,false);
 f.addTime(100000);await f.engine.command('teacher',{gameId:f.id,command:'extend',seconds:10});s=await f.engine.command('teacher',{gameId:f.id,command:'resume'});assert.equal(s.round.clock.deadlineAt-f.time(),60000);
 f.addTime(30000);await send(f,f.sessions[1],s.round.id,'TEST0');await send(f,f.sessions[0],s.round.id,'wrong');f.addTime(30000);s=await f.engine.state({gameId:f.id},'teacher');assert.equal(s.status,'closed');assert.equal(s.round.results[f.sessions[0].groupId].points,0);assert.equal(s.round.results[f.sessions[1].groupId].points,8);
});
test('T13 eight simultaneous submissions and identical concurrent retries use CAS without data loss',async()=>{
 const f=await fixture({count:1}),s=await start(f);await Promise.all(f.sessions.map((session,i)=>send(f,session,s.round.id,'TEST0','request-'+i)));
 const results=await Promise.all(Array.from({length:6},()=>send(f,f.sessions[0],s.round.id,'TEST0','repeated-request')));assert.ok(results.every(x=>x.responseId===results[0].responseId));
 assert.equal((await f.store.events(f.id)).length,9);const state=await f.engine.command('t',{gameId:f.id,command:'close'});assert.equal(Object.keys(state.round.results).length,8);assert.ok(Object.values(state.round.results).every(x=>x.points===10));
});
test('T16 student/projector cannot see unrevealed answers or other-group response text',async()=>{
 const f=await fixture({count:1}),s=await start(f);await send(f,f.sessions[0],s.round.id,'SECRET_WRONG');const student=await f.engine.state(f.sessions[1],'student');const projector=await f.engine.state({gameId:f.id,token:f.created.projectorToken},'projector');
 for(const data of [student,projector]){const serialized=JSON.stringify(data);assert.ok(!serialized.includes('TEST0'));assert.ok(!serialized.includes('SECRET_WRONG'));assert.ok(!serialized.includes('primaryAnswer'));assert.ok(!serialized.includes('tokenHash'));assert.ok(!serialized.includes('"rank":'));}
 await assert.rejects(()=>f.engine.state({gameId:f.id,token:'invalid'},'student'),e=>e.code==='SESSION');await assert.rejects(()=>f.engine.state({gameId:f.id,token:'invalid'},'projector'),e=>e.code==='PROJECTOR');
 await f.engine.command('t',{gameId:f.id,command:'proxy',groupId:f.sessions[0].groupId,answer:'TEST0',reason:'架空の試験'});assert.ok((await f.engine.state(f.sessions[1],'student')).scores.every(s=>s.totalPoints===0));await f.engine.command('t',{gameId:f.id,command:'close'});assert.ok((await f.engine.state(f.sessions[1],'student')).scores.every(s=>s.totalPoints===0));await f.engine.command('t',{gameId:f.id,command:'reveal'});assert.equal((await f.engine.state(f.sessions[1],'student')).round.primaryAnswer,'TEST0');
});
test('T17/T18 reassign invalidates old token and permits new device during an active round',async()=>{
 const f=await fixture({count:1});await start(f);await f.engine.command('t',{gameId:f.id,command:'reassign',groupId:f.sessions[0].groupId});await assert.rejects(()=>f.engine.state(f.sessions[0],'student'),e=>e.code==='SESSION');
 const fresh=await f.engine.join({code:f.created.joinCode,groupId:f.sessions[0].groupId});assert.notEqual(fresh.token,f.sessions[0].token);const state=await f.engine.state(fresh,'student');assert.equal(state.status,'question');assert.equal(state.myAnswer,null);
});
test('T14 teacher rescue is audited, score corrections recalculate totals, all response histories retained',async()=>{
 const f=await fixture({count:1}),s=await start(f);f.addTime(70000);await f.engine.state({gameId:f.id},'teacher');await f.engine.command('t',{gameId:f.id,command:'proxy',groupId:f.sessions[0].groupId,answer:'TEST0',reason:'架空の通信障害の救済'});
 let result=await f.engine.command('t',{gameId:f.id,command:'overrideScore',groupId:f.sessions[0].groupId,roundId:s.round.id,isCorrect:true,points:10,reason:'架空の教師修正'});assert.equal(result.scores.find(s=>s.groupId===f.sessions[0].groupId).totalPoints,10);assert.ok(result.audit.some(e=>e.action==='game.proxy'));assert.ok(result.audit.some(e=>e.action==='game.overrideScore'));assert.equal((await f.store.events(f.id)).length,1);
});
test('T24/T26 isolated eight-group full engine game: opening, 5 questions, hints, reconnect, rescue, reverse ranks',async()=>{
 const f=await fixture(),ids=f.sessions.map(s=>s.groupId);let state=await start(f);
 for(let index=0;index<5;index++){
   assert.equal(state.status,'question');const round=state.round,answer='TEST'+index;
   await Promise.all([send(f,f.sessions[0],round.id,answer),send(f,f.sessions[1],round.id,answer),send(f,f.sessions[3],round.id,answer),send(f,f.sessions[4],round.id,'wrong')]);
   f.setTime(round.clock.hintDueAt+1);await send(f,f.sessions[2],round.id,answer);await send(f,f.sessions[3],round.id,'wrong');
   f.setTime(round.clock.deadlineAt+1);assert.equal((await send(f,f.sessions[6],round.id,answer)).accepted,false);await f.engine.state(f.sessions[6],'student');
   await f.engine.command('teacher',{gameId:f.id,command:'proxy',groupId:ids[7],answer,reason:'架空の代理回答'});state=await f.engine.command('teacher',{gameId:f.id,command:'reveal'});assert.equal(state.status,'reveal');
   await f.engine.command('teacher',{gameId:f.id,command:'overrideScore',groupId:ids[7],roundId:round.id,isCorrect:true,points:5,reason:'架空の修正'});state=await f.engine.command('teacher',{gameId:f.id,command:'next'});
 }
 assert.equal(state.status,'ranking');const revealed=[];for(let i=0;i<8;i++){state=await f.engine.state({gameId:f.id},'teacher');revealed.push(state.ranking.at(-1)?.totalPoints??0);f.addTime(1100);}
 assert.equal(state.status,'ended');assert.deepEqual(state.scores.map(s=>s.totalPoints),[90,90,66,0,0,0,0,25]);assert.equal(state.scores.find(s=>s.groupId===ids[0]).rank,1);assert.equal(state.scores.find(s=>s.groupId===ids[1]).rank,1);assert.ok(revealed.every((v,i)=>!i||v>=revealed[i-1]));assert.equal((await f.engine.results()).length,0);assert.deepEqual(await f.engine.questionStats(),{});
});
test('T21 snapshot survives question edit and year switch, settings validation',async()=>{
 const f=await fixture({count:1});const original=await f.engine.teacherGame(f.id);await f.engine.saveQuestion('t',{...f.catalog.questions[0],body:'変更後'});assert.equal((await f.engine.teacherGame(f.id)).rounds[0].question.body,original.rounds[0].question.body);
 await f.engine.createYear('t',{label:'次の架空年度',startDate:'2027-04-01',endDate:'2028-03-31',classes:[{name:'架空クラスB',groupCount:6}]});assert.equal((await f.engine.catalog()).years.length,2);assert.equal((await f.engine.teacherGame(f.id)).className,'架空クラス');await assert.rejects(()=>f.engine.saveSettings('t',{backupRetention:0}));
});
test('T19/T22 uploaded image bytes verified, references prevent deletion, backup and isolated restore verify files/events/settings',async()=>{
 const f=await fixture({count:1}),bucket=new Bucket(),files=new Files(f.store,f.engine,bucket);await assert.rejects(()=>files.upload('t',{data:'data:image/svg+xml;base64,'+btoa('<svg/>')}));
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0]);const file=await files.upload('t',{name:'架空の検証画像.png',data:'data:image/png;base64,'+btoa(String.fromCharCode(...bytes)),licenseNotes:'自作検証用'});
 await files.attach('t',{questionId:f.catalog.questions[0].questionId,fileId:file.id,altText:'架空画像',licenseNotes:'検証',command:'attach'});await assert.rejects(()=>files.remove('t',{fileId:file.id,confirm:true}),e=>e.code==='FILE_REFERENCED');
 const backup=await files.backup('t');assert.equal(backup.status,'complete');const before=JSON.stringify(await f.store.read('catalog'));const restored=await files.restoreTest('t',backup.id);assert.equal(restored.files,1);assert.equal(restored.productionUnchanged,true);assert.equal(JSON.stringify(await f.store.read('catalog')),before);const rec=await f.store.read(restored.namespace+'catalog');assert.ok(rec.value.questions[0].images[0].fileId.startsWith('restored/'));
 const automatic=await files.backup('scheduled',{automatic:true});assert.equal(automatic.skipped,true);
});
test('T10 D1 transaction rollback prevents response/audit rows on CAS failure',async()=>{
 const store=new Store(new D1());await store.put('x',{n:0});await Promise.all(Array.from({length:6},(_,i)=>store.mutate('x',async d=>{await new Promise(r=>setTimeout(r,1));d.n++;return{result:true,events:[{key:'event-'+i,kind:'audit',gameId:'x',payload:{n:d.n}}]}})));
 assert.equal((await store.read('x')).value.n,6);assert.equal((await store.events('x')).length,6);
});
