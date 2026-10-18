import Rules from './rules.mjs';
import {ensure,QuizError} from './store.mjs';
export const DEFAULTS={...Rules.defaults,backupEnabled:true,backupIntervalHours:24,backupRetention:7};
export async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
const uid=()=>crypto.randomUUID();
const nowIso=()=>new Date().toISOString();
export const freshCatalog=()=>({years:[],questions:[],settings:structuredClone(DEFAULTS),lastGameSettings:null,audit:[]});
const text=(v,n=2000)=>{ensure(typeof v==='string'&&v.trim().length>0&&v.length<=n,'INPUT','入力内容を確認してください。');return v.trim();};
const integer=(v,min,max)=>{ensure(Number.isInteger(v)&&v>=min&&v<=max,'INPUT','数値が範囲外です。');return v;};
const audit=(doc,actor,action,details)=>{doc.audit??=[];doc.audit.push({id:uid(),at:nowIso(),actor,action,details});};
export class Engine {
 constructor(store,{clock=()=>Date.now()}={}){this.store=store;this.now=clock;}
 async catalog(){return(await this.store.read('catalog'))?.value??freshCatalog();}
 async updateCatalog(actor,fn){return this.store.mutate('catalog',async c=>{const result=await fn(c);const events=c.audit.map(e=>({key:'audit:'+e.id,gameId:'catalog',kind:'audit',payload:e}));c.audit=[];return{result,events};},freshCatalog());}
 async saveSettings(actor,input){return this.updateCatalog(actor,c=>{
   const next={...c.settings};
   for(const key of ['openingSeconds','explanationSeconds','transitionSeconds','rankingSeconds'])if(input[key]!==undefined)next[key]=integer(input[key],0,300);
   if(input.backupIntervalHours!==undefined)next.backupIntervalHours=integer(input.backupIntervalHours,1,168);
   if(input.backupRetention!==undefined)next.backupRetention=integer(input.backupRetention,1,30);
   if(input.backupEnabled!==undefined)next.backupEnabled=!!input.backupEnabled;
   if(input.volume!==undefined){ensure(typeof input.volume==='number'&&input.volume>=0&&input.volume<=1,'INPUT');next.volume=input.volume;}
   if(input.muted!==undefined)next.muted=!!input.muted;
   if(input.hintRemainingSeconds){for(const d of ['easy','standard','hard'])next.hintRemainingSeconds[d]=integer(input.hintRemainingSeconds[d],0,Rules.rules[d].seconds);}
   c.settings=next;audit(c,actor,'settings.update',next);return next;
 });}
 async createYear(actor,input){return this.updateCatalog(actor,c=>{
   Rules.isoDate(input.startDate);Rules.isoDate(input.endDate);ensure(input.startDate<input.endDate,'DATES');
   ensure(Array.isArray(input.classes)&&input.classes.length>0&&input.classes.length<=30,'CLASSES');
   const year={id:uid(),label:text(input.label,80),startDate:input.startDate,endDate:input.endDate,classes:[]};
   const names=new Set();for(const entry of input.classes){const name=text(entry.name,80);ensure(!names.has(name),'DUPLICATE_CLASS');names.add(name);const count=integer(entry.groupCount,1,30);
     year.classes.push({id:uid(),name,groups:Array.from({length:count},(_,i)=>({id:uid(),name:`${i+1}班`,number:i+1}))});}
   c.years.push(year);c.activeYearId=year.id;audit(c,actor,'year.create',{id:year.id,label:year.label});return year;
 });}
 async activateYear(actor,id){return this.updateCatalog(actor,c=>{ensure(c.years.some(y=>y.id===id),'NOT_FOUND');c.activeYearId=id;audit(c,actor,'year.activate',{id});return true;});}
 async saveQuestion(actor,input){return this.updateCatalog(actor,c=>{
   const parsed=Rules.validateQuestion(input),previous=input.questionId?c.questions.find(q=>q.questionId===input.questionId):null;
   ensure(!input.questionId||previous,'NOT_FOUND');
   const q={...parsed,questionId:previous?.questionId??uid(),version:(previous?.version??0)+1,createdAt:previous?.createdAt??nowIso(),updatedAt:nowIso(),approvalStatus:'unreviewed',reuseEnabled:input.reuseEnabled!==false,archived:false,images:previous?.images??[],similarQuestionIds:Rules.similarQuestions(parsed,c.questions.filter(q=>q.questionId!==previous?.questionId)).map(q=>q.questionId)};
   if(previous)c.questions[c.questions.indexOf(previous)]=q;else c.questions.push(q);
   audit(c,actor,'question.save',{id:q.questionId,version:q.version});return q;
 });}
 async importQuestions(actor,inputs){ensure(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=200,'IMPORT_LIMIT','1回に1〜200問を取り込めます。');const validated=inputs.map(q=>Rules.validateQuestion(q));
   return this.updateCatalog(actor,c=>{const added=[];for(const q of validated){const doc={...q,questionId:uid(),version:1,createdAt:nowIso(),updatedAt:nowIso(),approvalStatus:'unreviewed',reuseEnabled:true,archived:false,images:[],similarQuestionIds:Rules.similarQuestions(q,c.questions).map(x=>x.questionId)};c.questions.push(doc);added.push(doc);}audit(c,actor,'question.import',{count:added.length});return added;});
 }
 async questionAction(actor,input){return this.updateCatalog(actor,c=>{const q=c.questions.find(q=>q.questionId===input.id);ensure(q,'NOT_FOUND');
   if(input.command==='approve'){q.approvalStatus='approved';}
   else if(input.command==='reject')q.approvalStatus='rejected';
   else if(input.command==='archive')q.archived=true;
   else if(input.command==='restore')q.archived=false;
   else if(input.command==='duplicate'){const copy={...structuredClone(q),questionId:uid(),version:1,title:q.title+'（複製）',approvalStatus:'unreviewed',createdAt:nowIso(),updatedAt:nowIso()};c.questions.push(copy);audit(c,actor,'question.duplicate',{id:copy.questionId,from:q.questionId});return copy;}
   else throw new QuizError('COMMAND');q.version++;q.updatedAt=nowIso();audit(c,actor,'question.'+input.command,{id:q.questionId});return q;});}
 async preview(input){const c=await this.catalog();const games=await this.store.list('game:');const used=[];
   games.forEach(({value:g})=>{if(!g.isSimulation&&g.classId===input.classId&&g.startedAt)g.rounds.filter(r=>r.startedAt).forEach(r=>used.push(r.question.questionId));});
   const criteria={count:integer(input.count,1,20),fields:input.fields||[],units:input.units||[],distribution:input.distribution};
   const selection=Rules.selectQuestions(c.questions,criteria,used);return {...selection,estimate:Rules.estimate(selection.selected,c.settings)};
 }
 async createGame(actor,input){const c=await this.catalog();const year=c.years.find(y=>y.id===input.yearId),klass=year?.classes.find(k=>k.id===input.classId);ensure(klass,'CLASS_REQUIRED','年度とクラスを設定してください。');
   ensure(Array.isArray(input.questionIds)&&input.questionIds.length>0&&input.questionIds.length<=20,'QUESTIONS_REQUIRED');ensure(new Set(input.questionIds).size===input.questionIds.length,'DUPLICATE_QUESTION');
   const qs=input.questionIds.map(id=>{const q=c.questions.find(q=>q.questionId===id);ensure(q&&q.approvalStatus==='approved'&&!q.archived&&q.reuseEnabled,'QUESTION_NOT_APPROVED');return structuredClone(q);});
   const selection=await this.preview({...input,count:input.count??qs.length});
   const offFilter=qs.some(q=>(input.fields?.length&&!input.fields.includes(q.field))||(input.units?.length&&!input.units.includes(q.unit)));
   const offDistribution=input.distribution&&Object.entries(input.distribution).some(([d,n])=>qs.filter(q=>q.difficulty===d).length!==n);
   if(selection.requiresApproval||offFilter||offDistribution){ensure(input.alternativeApproved===true,'ALTERNATIVE_APPROVAL','条件を変更した候補の明示承認が必要です。');}
   const id=uid(),token=uid()+uid(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
   const game={id,owner:actor,yearId:year.id,yearLabel:year.label,classId:klass.id,className:klass.name,groups:structuredClone(klass.groups),status:'draft',codeHash:await hash(code),codeExpiresAt:this.now()+c.settings.joinCodeLifetimeMinutes*60000,
     projectorHash:await hash(token),participants:[],rounds:qs.map(question=>({id:uid(),question,responses:{},scores:{},receivers:[],clock:null})),index:-1,settings:structuredClone(c.settings),createdAt:nowIso(),startedAt:null,endedAt:null,isSimulation:input.isSimulation===true,revision:1,audit:[],criteria:{fields:input.fields||[],units:input.units||[],distribution:input.distribution},rankShown:0};
   const collision=(await this.store.list('game:')).some(r=>r.value.codeHash===game.codeHash&&r.value.codeExpiresAt>this.now()&&['draft','lobby'].includes(r.value.status));ensure(!collision,'CODE_COLLISION','参加コードを再発行してください。',409);
   audit(game,actor,'game.create',{questionIds:input.questionIds,alternativeApproved:!!input.alternativeApproved});
   await this.updateCatalog(actor,c=>{for(const q of qs){const live=c.questions.find(x=>x.questionId===q.questionId);ensure(live&&live.version===q.version&&live.approvalStatus==='approved'&&!live.archived,'QUESTION_CHANGED','問題が更新されました。候補を確認し直してください。',409);}c.usedFileIds??=[];for(const q of qs){for(const id of q.images.map(i=>i.fileId).concat(q.sources.map(s=>s.driveFileId).filter(Boolean))){ensure(!c.deletedFiles?.includes(id),'FILE_DELETED');if(!c.usedFileIds.includes(id))c.usedFileIds.push(id);}}return true;});
   await this.store.put('game:'+id,game);
   await this.updateCatalog(actor,c=>{c.lastGameSettings={...input,questionIds:undefined};return true;});return {game:this.view(game,'teacher'),joinCode:code,projectorToken:token};
 }
 async teacherGame(id){const row=await this.store.read('game:'+text(id,128));ensure(row,'NOT_FOUND','ゲームが見つかりません。',404);return row.value;}
 startRound(g,now){const r=g.rounds[g.index];r.receivers=g.participants.filter(p=>!p.revokedAt).map(p=>p.groupId);r.startedAt=now;r.clock=Rules.clock.start(r.question.difficulty,now,r.question.hintThresholdSeconds??g.settings.hintRemainingSeconds[r.question.difficulty]);g.status='question';}
 tick(g){const now=this.now();let changed=false;
   if(g.status==='opening'&&now>=g.openingUntil){g.index=0;this.startRound(g,g.openingUntil);changed=true;}
   if(g.status==='question'){const r=g.rounds[g.index],next=Rules.clock.tick(r.clock,now);if(JSON.stringify(next)!==JSON.stringify(r.clock)){r.clock=next;if(next.status==='closed'){g.status='closed';this.calculate(g);}changed=true;}}
   if(g.status==='ranking'&&now>=g.rankNextAt){const step=g.settings.rankingSeconds?Math.max(1000,g.settings.rankingSeconds*1000/Math.max(1,new Set(g.participants.map(p=>p.groupId)).size)):1;g.rankShown=Math.min(new Set(g.participants.map(p=>p.groupId)).size,g.rankShown+1);g.rankNextAt=now+step;if(g.rankShown>=new Set(g.participants.map(p=>p.groupId)).size){g.status='ended';g.endedAt=nowIso();}changed=true;}
   return changed;
 }
 calculate(g){for(const r of g.rounds){for(const groupId of r.receivers){const summary=r.responses[groupId];const correct=!!summary?.latest?.accepted&&Rules.correct(summary.latest.answerRaw,{...r.question,answers:r.question.acceptedAnswers.map(text=>({text}))});const eligible=correct&&!!summary.preHintCorrect;
     const rule=Rules.rules[r.question.difficulty];const prior=r.scores[groupId];if(!prior?.manualOverride)r.scores[groupId]={isCorrect:correct,preHintEligible:eligible,points:correct?(eligible?rule.full:rule.hinted):0,finalResponseId:summary?.latest?.responseId??null,answered:!!summary?.latest};}}
 }
 standings(g){const ids=[...new Set(g.rounds.flatMap(r=>r.receivers).concat(g.participants.map(p=>p.groupId)))];return Rules.rank(ids.map(id=>({groupId:id,name:g.groups.find(x=>x.id===id)?.name??'班',totalPoints:g.rounds.reduce((s,r)=>s+(r.scores[id]?.points??0),0)})));}
 async join(input){const code=text(input.code,20).replace(/\s/g,'');ensure(/^\d{6}$/.test(code),'JOIN_CODE','参加コードは6桁です。');const codeHash=await hash(code),games=await this.store.list('game:');const item=games.find(r=>r.value.codeHash===codeHash&&r.value.codeExpiresAt>this.now()&&['lobby','opening','question','paused','closed','reveal'].includes(r.value.status));ensure(item,'JOIN_CODE','コードが違うか、参加受付を終了しています。');
   if(input.lookup)return {gameId:item.value.id,className:item.value.className,groups:item.value.groups.map(g=>({id:g.id,name:g.name,joined:item.value.participants.some(p=>p.groupId===g.id&&!p.revokedAt)}))};
   const token=uid()+uid(),tokenHash=await hash(token);return this.store.mutate(item.key,g=>{ensure(g.codeExpiresAt>this.now(),'LOBBY_CLOSED');ensure(g.status==='lobby'||g.participants.some(p=>p.groupId===input.groupId&&p.revokedAt),'LOBBY_CLOSED','受付時間外です。端末の再割当ては先生に依頼してください。');ensure(g.groups.some(x=>x.id===input.groupId),'GROUP');ensure(!g.participants.some(p=>p.groupId===input.groupId&&!p.revokedAt),'GROUP_TAKEN','この班は参加済みです。先生に端末の再割当てを依頼してください。',409);
     g.participants.push({id:uid(),groupId:input.groupId,tokenHash,joinedAt:this.now(),lastSeenAt:this.now(),revokedAt:null});g.revision++;return {result:{gameId:g.id,token,groupId:input.groupId,groupName:g.groups.find(x=>x.id===input.groupId).name}};});
 }
 async participant(g,token){const digest=await hash(text(token,200));const p=g.participants.find(p=>p.tokenHash===digest&&!p.revokedAt);ensure(p,'SESSION','参加情報が失効しました。先生に確認してください。',403);return p;}
 async state(input,role){return this.store.mutate('game:'+text(input.gameId,128),async g=>{ensure(g,'NOT_FOUND');let p;if(role==='student')p=await this.participant(g,input.token);if(role==='projector')ensure(g.projectorHash===await hash(text(input.token,200)),'PROJECTOR', '投影用リンクを確認してください。',403);
     let changed=this.tick(g);if(p&&this.now()-p.lastSeenAt>15000){p.lastSeenAt=this.now();changed=true;}if(changed)g.revision++;
     return {noWrite:!changed,result:this.view(g,role,p)};});
 }
 view(g,role,p){const r=g.rounds[g.index],reveal=['reveal','ranking','ended'].includes(g.status),teacher=role==='teacher';
   const data={id:g.id,status:g.status,index:g.index,questionCount:g.rounds.length,className:g.className,yearLabel:g.yearLabel,revision:g.revision,serverNow:this.now(),settings:g.settings,openingUntil:g.openingUntil,rankShown:g.rankShown,explanationStep:g.explanationStep||1,
    groups:g.groups.map(group=>({...group,joined:g.participants.some(p=>p.groupId===group.id&&!p.revokedAt),connected:g.participants.some(p=>p.groupId===group.id&&!p.revokedAt&&this.now()-p.lastSeenAt<20000)})),
    scores:this.standings(g).map(row=>{const x={...row};if(!['ranking','ended'].includes(g.status))delete x.rank;return x;}).sort((a,b)=>g.groups.findIndex(x=>x.id===a.groupId)-g.groups.findIndex(x=>x.id===b.groupId)),
    round:r?{id:r.id,title:r.question.title,body:r.question.body,difficulty:r.question.difficulty,images:role==='student'?[]:r.question.images,hint:r.clock?.hintShownAt!==null&&r.clock?.hintShownAt!==undefined?r.question.hintText:null,clock:r.clock,
      answered:r.receivers.filter(id=>r.responses[id]?.latest),results:reveal||teacher?r.scores:null,...(reveal||teacher?{primaryAnswer:r.question.primaryAnswer,explanation:r.question.explanation,acceptedAnswers:r.question.acceptedAnswers}:{})}:null};
   if(teacher){data.rounds=g.rounds;data.participants=g.participants.map(({tokenHash,...rest})=>rest);data.audit=g.audit;data.responses=r?.responses??{};data.isSimulation=g.isSimulation;}
   if(p)data.myAnswer=r?.responses[p.groupId]?.latest??null;
   if(['ranking','ended'].includes(g.status)){const sorted=this.standings(g).reverse();data.ranking=sorted.slice(0,g.rankShown);data.review=g.rounds.map(r=>({title:r.question.title,body:r.question.body,answer:r.question.primaryAnswer,explanation:r.question.explanation}));}
   return data;
 }
 async submit(input){const gameId=text(input.gameId,128),roundId=text(input.roundId,128),requestId=text(input.requestId,128);ensure(/^[a-zA-Z0-9_-]+$/.test(requestId),'REQUEST_ID');const answer=text(input.answer,2000);
   return this.store.mutate('game:'+gameId,async g=>{ensure(g,'NOT_FOUND');const p=await this.participant(g,input.token);const eventKey=['response',gameId,roundId,p.groupId,requestId].join(':');const existing=await this.store.event(eventKey);if(existing)return {noWrite:true,result:existing};
     this.tick(g);const r=g.rounds.find(r=>r.id===roundId);ensure(r,'ROUND');const now=this.now();const accepted=g.status==='question'&&g.rounds[g.index].id===roundId&&Rules.clock.acceptance(r.clock,now).accepted;
     const receipt={responseId:uid(),gameId,roundId,groupId:p.groupId,requestId,answerRaw:answer,answerNormalized:Rules.normalize(answer),serverReceivedAt:new Date(now).toISOString(),accepted,isPreHint:accepted&&Rules.clock.acceptance(r.clock,now).isPreHint,source:'student'};
     if(accepted){const summary=r.responses[p.groupId]??{preHintCorrect:false,count:0};summary.latest=receipt;summary.count++;if(receipt.isPreHint&&Rules.correct(answer,{...r.question,answers:r.question.acceptedAnswers.map(text=>({text}))}))summary.preHintCorrect=true;r.responses[p.groupId]=summary;}
     p.lastSeenAt=now;g.revision++;return {result:receipt,events:[{key:eventKey,gameId,kind:'response',payload:receipt}]};});
 }
 async command(actor,input){return this.store.mutate('game:'+text(input.gameId,128),g=>{ensure(g,'NOT_FOUND');this.tick(g);const now=this.now(),command=input.command,r=input.command==='overrideScore'&&input.roundId?g.rounds.find(x=>x.id===input.roundId):g.rounds[g.index];const was=g.status;
   if(command==='open'){ensure(g.status==='draft','TRANSITION');g.status='lobby';}
   else if(command==='start'){ensure(g.status==='lobby','TRANSITION');g.status='opening';g.startedAt=nowIso();g.openingUntil=now+g.settings.openingSeconds*1000;this.tick(g);}
   else if(command==='skipOpening'){ensure(g.status==='opening','TRANSITION');g.index=0;this.startRound(g,now);}
   else if(command==='pause'){ensure(g.status==='question','TRANSITION');r.clock=Rules.clock.pause(r.clock,now);g.status='paused';}
   else if(command==='resume'){ensure(g.status==='paused','TRANSITION');r.clock=Rules.clock.resume(r.clock,now);g.status='question';}
   else if(command==='extend'){ensure(['question','paused'].includes(g.status),'TRANSITION');r.clock=Rules.clock.extend(r.clock,now,integer(input.seconds,1,600));}
   else if(command==='close'){ensure(['question','paused'].includes(g.status),'TRANSITION');r.clock.status='closed';r.closedAt=now;g.status='closed';this.calculate(g);}
   else if(command==='reveal'){ensure(g.status==='closed','TRANSITION');g.status='reveal';g.explanationStep=1;}
   else if(command==='explainNext'){ensure(g.status==='reveal','TRANSITION');g.explanationStep=Math.min(r.question.explanation.split('\n').length,(g.explanationStep||1)+1);}
   else if(command==='next'){ensure(g.status==='reveal','TRANSITION');if(g.index+1<g.rounds.length){g.index++;this.startRound(g,now);}else{this.calculate(g);g.status='ranking';g.rankShown=0;g.rankNextAt=now;}}
   else if(command==='skipRanking'){ensure(g.status==='ranking','TRANSITION');g.rankShown=new Set(g.participants.map(p=>p.groupId)).size;g.status='ended';g.endedAt=nowIso();}
   else if(command==='reassign'){const p=g.participants.find(p=>p.groupId===input.groupId&&!p.revokedAt);ensure(p,'NOT_FOUND');p.revokedAt=now;}
   else if(command==='reopenJoin'){ensure(!['ranking','ended'].includes(g.status),'TRANSITION');ensure(g.status==='lobby','TRANSITION','再参加は参加受付中に行ってください。');g.codeExpiresAt=now+g.settings.joinCodeLifetimeMinutes*60000;}
   else if(command==='overrideScore'){ensure(r&&['closed','reveal','ranking','ended'].includes(g.status),'TRANSITION');ensure(r.receivers.includes(input.groupId),'GROUP');const reason=text(input.reason,1000);r.scores[input.groupId]={...r.scores[input.groupId],isCorrect:!!input.isCorrect,points:integer(input.points,0,1000),preHintEligible:!!r.scores[input.groupId]?.preHintEligible,manualOverride:true,overrideReason:reason};}
   else if(command==='proxy'){ensure(r&&r.receivers.includes(input.groupId),'GROUP');ensure(['question','paused','closed','reveal'].includes(g.status),'TRANSITION');const reason=text(input.reason,1000),answer=text(input.answer,2000),summary=r.responses[input.groupId]??{preHintCorrect:false,count:0};
     const receipt={responseId:uid(),gameId:g.id,roundId:r.id,groupId:input.groupId,requestId:uid(),answerRaw:answer,serverReceivedAt:new Date(now).toISOString(),accepted:true,isPreHint:g.status==='question'&&now<r.clock.hintDueAt,source:'teacher',reason};
     summary.latest=receipt;summary.count++;if(receipt.isPreHint&&Rules.correct(answer,{...r.question,answers:r.question.acceptedAnswers.map(text=>({text}))}))summary.preHintCorrect=true;r.responses[input.groupId]=summary;this.calculate(g);
     g.revision++;audit(g,actor,'game.proxy',{...input,reason});return{result:this.view(g,'teacher'),events:[{key:'proxy:'+receipt.responseId,gameId:g.id,kind:'response',payload:receipt}]};}
   else if(command==='editQuestions'){ensure(g.status==='draft','TRANSITION');ensure(Array.isArray(input.order)&&input.order.length===g.rounds.length&&new Set(input.order).size===g.rounds.length&&input.order.every(id=>g.rounds.some(r=>r.id===id)),'ORDER');g.rounds=input.order.map(id=>g.rounds.find(r=>r.id===id));}
   else throw new QuizError('COMMAND');g.revision++;audit(g,actor,'game.'+command,{from:was,...input});return {result:this.view(g,'teacher')};});}
 async renewCode(actor,input){const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000),digest=await hash(code);
   return this.store.mutate('game:'+input.gameId,g=>{ensure(g&&!['ended','ranking'].includes(g.status),'TRANSITION');g.codeHash=digest;g.codeExpiresAt=this.now()+g.settings.joinCodeLifetimeMinutes*60000;g.revision++;audit(g,actor,'code.rotate',{});return{result:{joinCode:code}};});
 }
 async renewProjection(actor,input){const token=uid()+uid(),digest=await hash(token);return this.store.mutate('game:'+input.gameId,g=>{ensure(g,'NOT_FOUND');g.projectorHash=digest;g.revision++;audit(g,actor,'projector.rotate',{});return{result:{projectorToken:token}};});}
 async results(){return(await this.store.list('game:')).filter(row=>!row.value.isSimulation).map(({value:g})=>({id:g.id,status:g.status,className:g.className,yearLabel:g.yearLabel,createdAt:g.createdAt,endedAt:g.endedAt,totals:this.standings(g)}));}
 async questionStats(){const games=(await this.store.list('game:')).map(r=>r.value).filter(g=>!g.isSimulation);const byId={};for(const g of games){for(const r of g.rounds){if(!r.startedAt||r.clock?.status!=='closed')continue;for(const groupId of r.receivers){(byId[r.question.questionId]??=[]).push({...r.scores[groupId],classId:g.classId,gameId:g.id});}}}return Object.fromEntries(Object.entries(byId).map(([id,rows])=>[id,{...Rules.statistics(rows),usage:rows.map(r=>({classId:r.classId,gameId:r.gameId}))}]));}
}
