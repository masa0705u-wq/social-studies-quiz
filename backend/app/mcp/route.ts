import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../chatgpt-auth';
import {Store} from '../../lib/quiz/store.mjs';
import {Engine} from '../../lib/quiz/engine.mjs';
import {Files} from '../../lib/quiz/files.mjs';
export const dynamic='force-dynamic';
const tools=[{name:'backup_status',description:'社会科ナゾトキ教室のバックアップとテスト復元の状態を確認する。',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'backup_if_due',description:'設定された周期に達している場合だけ、非公開の問題・成績・回答履歴・設定・画像・資料をバックアップする。前回成功からの時間と世代設定を守る。',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
export async function POST(request:Request){const rpc=await request.json() as any;const response=(result:any)=>Response.json({jsonrpc:'2.0',id:rpc.id??null,result},{headers:{'Cache-Control':'no-store'}});
 if(rpc.method==='server/discover')return response({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(rpc.method==='tools/list')return response({tools});
 const user=await getChatGPTUser();const ids=String((env as any).QUIZ_TEACHER_IDS||'').split(','),emails=String((env as any).QUIZ_TEACHER_EMAILS||'').toLowerCase().split(',');
 if(!user||(!ids.includes(user.userId)&&!emails.includes(user.email.toLowerCase())))return new Response('Forbidden',{status:403});
 try{if(rpc.method!=='tools/call'||!tools.some(t=>t.name===rpc.params?.name))throw Error('対応していない操作です。');if(!env.DB||!env.BUCKET)throw Error('保存基盤が未接続です。');const store=new Store(env.DB),engine=new Engine(store);
  const result=rpc.params.name==='backup_if_due'?await new Files(store,engine,env.BUCKET).backup(user.userId,{automatic:true}):{backups:(await store.list('backup:')).map((x:any)=>x.value),restoreRuns:(await store.list('restore-run:')).map((x:any)=>x.value)};
  return response({content:[{type:'text',text:JSON.stringify(result)}]});
 }catch(error:any){return response({isError:true,content:[{type:'text',text:error.message}]});}}
