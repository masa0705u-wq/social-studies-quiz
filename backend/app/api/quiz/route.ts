import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { Store, QuizError, ensure } from '../../../lib/quiz/store.mjs';
import { Engine, hash } from '../../../lib/quiz/engine.mjs';
import { Files } from '../../../lib/quiz/files.mjs';
export const dynamic='force-dynamic';
function cors(request:Request):Record<string,string>{const origin=request.headers.get('Origin');const own=new URL(request.url).origin;const allowed=String((env as any).QUIZ_ALLOWED_ORIGIN||'');return origin&&(origin===own||origin===allowed)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{'Vary':'Origin'};}
export async function OPTIONS(request:Request){return new Response(null,{status:204,headers:{...cors(request),'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});}
export async function POST(request:Request){
 const headers={...cors(request),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
   ensure(env.DB&&env.BUCKET,'STORAGE_UNAVAILABLE','保存サービスに接続できません。',503);
   const bodyText=await request.text();ensure(bodyText.length<8000000,'BODY_TOO_LARGE','送信データが大きすぎます。',413);const body=JSON.parse(bodyText);const action=body.action,input=body.input||{};
   const store=new Store(env.DB),engine=new Engine(store),files=new Files(store,engine,env.BUCKET);
   const publicActions=['join','state','submit','projectorState','image'];let actor='';
   if(!publicActions.includes(action)){
      const origin=request.headers.get('Origin');ensure(!origin||origin===new URL(request.url).origin,'ORIGIN','教師操作は先生用画面から行ってください。',403);
      const user=await getChatGPTUser();const allowed=String((env as any).QUIZ_TEACHER_IDS||'').split(',');const emails=String((env as any).QUIZ_TEACHER_EMAILS||'').toLowerCase().split(',');if(!user||(!allowed.includes(user.userId)&&!emails.includes(user.email.toLowerCase())))throw new QuizError('TEACHER_REQUIRED','先生のChatGPTアカウントでログインしてください。',403);actor=user.userId;
   }
   let result:any;
   if(action==='teacher.me')result={authorized:true};
   else if(action==='catalog')result={...await engine.catalog(),statistics:await engine.questionStats()};
   else if(action==='settings')result=await engine.saveSettings(actor,input);
   else if(action==='createYear')result=await engine.createYear(actor,input);
   else if(action==='activateYear')result=await engine.activateYear(actor,input.id);
   else if(action==='saveQuestion')result=await engine.saveQuestion(actor,input);
   else if(action==='importQuestions')result=await engine.importQuestions(actor,input.questions);
   else if(action==='questionAction')result=await engine.questionAction(actor,input);
   else if(action==='preview')result=await engine.preview(input);
   else if(action==='createGame')result=await engine.createGame(actor,input);
   else if(action==='command')result=await engine.command(actor,input);
   else if(action==='teacherState')result=await engine.state(input,'teacher');
   else if(action==='renewCode')result=await engine.renewCode(actor,input);
   else if(action==='renewProjection')result=await engine.renewProjection(actor,input);
   else if(action==='results')result=await engine.results();
   else if(action==='responseHistory')result=await store.events(input.gameId);
   else if(action==='audit')result=await store.events('catalog');
   else if(action==='join'){
     const ip=request.headers.get('CF-Connecting-IP')||'unknown';const key='rate:'+await hash(ip+new Date().toISOString().slice(0,10));
     await store.mutate(key,(d:{at:number,count:number})=>{const now=Date.now();if(now-d.at>60000){d.at=now;d.count=0;}ensure(d.count<30,'RATE_LIMIT','参加の試行が集中しています。1分後に再試行してください。',429);d.count++;return{result:true};},{at:Date.now(),count:0});result=await engine.join(input);
   }
   else if(action==='state')result=await engine.state(input,'student');
   else if(action==='projectorState')result=await engine.state(input,'projector');
   else if(action==='submit')result=await engine.submit(input);
   else if(action==='uploadFile')result=await files.upload(actor,input);
   else if(action==='attachImage'){if(input.command!=='detach'&&input.command!=='reorder'){ensure(await store.read('file:'+input.fileId),'NOT_FOUND');}result=await files.attach(actor,input);}
   else if(action==='deleteFile')result=await files.remove(actor,input);
   else if(action==='listFiles')result=(await store.list('file:')).map((x:{value:any})=>x.value);
   else if(action==='teacherImage')result=await files.read(input.fileId);
   else if(action==='image'){
      const g=await engine.teacherGame(input.gameId);ensure(g.projectorHash===await hash(input.token),'PROJECTOR','投影情報を確認してください。',403);
      const r=g.rounds[g.index];ensure(r?.question.images.some((i:any)=>i.fileId===input.fileId),'FILE_FORBIDDEN','現在の問題画像だけ取得できます。',403);result=await files.read(input.fileId);
   }
   else if(action==='backup')result=await files.backup(actor);
   else if(action==='backupStatus')result=(await store.read('backup-scheduler'))?.value??null;
   else if(action==='backups')result=(await store.list('backup:')).map((x:{value:any})=>x.value).sort((a:any,b:any)=>(b.finishedAt||'').localeCompare(a.finishedAt||''));
   else if(action==='restoreTest')result=await files.restoreTest(actor,input.id);
   else if(action==='restoreRuns')result=(await store.list('restore-run:')).map((x:{value:any})=>x.value);
   else throw new QuizError('ACTION','この操作には対応していません。');
   return new Response(JSON.stringify({ok:true,result}),{headers});
 }catch(error:any){const known=error instanceof QuizError;return new Response(JSON.stringify({ok:false,code:known?error.code:'SERVER_ERROR',message:known?error.message:'処理を完了できませんでした。接続と入力内容を確認してください。'}),{status:known?error.status:500,headers});}
}
