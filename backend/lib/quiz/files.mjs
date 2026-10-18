import {ensure} from './store.mjs';
import {hash} from './engine.mjs';
const uuid=()=>crypto.randomUUID();
const iso=()=>new Date().toISOString();
export class Files {
 constructor(store,engine,bucket){this.store=store;this.engine=engine;this.bucket=bucket;}
 async scheduledBackup(actor='scheduled'){
   const startedAt=iso();await this.store.put('backup-scheduler',{actor,startedAt,status:'running'});
   try{
     const result=await this.backup(actor,{automatic:true});
     await this.store.put('backup-scheduler',{actor,startedAt,finishedAt:iso(),status:result.skipped?'skipped':'complete',backupId:result.id??null});
     return result;
   }catch(error){await this.store.put('backup-scheduler',{actor,startedAt,finishedAt:iso(),status:'failed',error:String(error.message)});throw error;}
 }
 async upload(actor,input){
   ensure(typeof input.data==='string'&&input.data.length<7500000,'FILE_SIZE','画像は2MB、参考資料は5MBまでです。',413);
   const match=/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input.data);ensure(match,'FILE_FORMAT');
   const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));const mime=match[1];
   const magic=(mime==='image/png'&&bytes[0]===137&&bytes[1]===80)||(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216)||(mime==='image/gif'&&String.fromCharCode(...bytes.slice(0,3))==='GIF')||(mime==='image/webp'&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')||(mime==='application/pdf'&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-');
   ensure(magic,'FILE_FORMAT','PNG/JPEG/GIF/WebP/PDFを選択してください。');const isImage=mime.startsWith('image/');ensure(bytes.length<=(isImage?2097152:5242880),'FILE_SIZE');
   const key=(isImage?'assets/':'sources/')+uuid();await this.bucket.put(key,bytes,{httpMetadata:{contentType:mime}});
   await this.store.put('file:'+key,{id:key,name:String(input.name||'資料').slice(0,200),mime,size:bytes.length,createdAt:iso(),licenseNotes:String(input.licenseNotes||'').slice(0,2000),actor});return {id:key,mime,name:input.name};
 }
 async attach(actor,input){return this.engine.updateCatalog(actor,c=>{const q=c.questions.find(q=>q.questionId===input.questionId);ensure(q,'NOT_FOUND');
   if(input.command==='detach')q.images=q.images.filter(i=>i.fileId!==input.fileId);
   else if(input.command==='reorder'){ensure(input.order.length===q.images.length&&new Set(input.order).size===q.images.length&&input.order.every(id=>q.images.some(i=>i.fileId===id)),'ORDER');q.images=input.order.map(id=>q.images.find(i=>i.fileId===id));}
   else{ensure(!c.deletedFiles?.includes(input.fileId),'FILE_DELETED','削除処理中の画像は添付できません。');ensure(typeof input.fileId==='string'&&input.fileId.startsWith('assets/'),'FILE');ensure(!q.images.some(i=>i.fileId===input.fileId),'DUPLICATE_IMAGE');q.images.push({fileId:input.fileId,altText:String(input.altText||q.title).slice(0,500),licenseNotes:String(input.licenseNotes||'').slice(0,2000)});}
   q.version++;q.approvalStatus='unreviewed';q.updatedAt=iso();c.audit.push({id:uuid(),at:iso(),actor,action:'image.'+input.command,details:{questionId:q.questionId,fileId:input.fileId}});return q;});}
 async read(fileId){ensure(typeof fileId==='string'&&/^(assets|sources)\/[a-zA-Z0-9-]+$/.test(fileId),'FILE');const o=await this.bucket.get(fileId);ensure(o,'NOT_FOUND');const bytes=new Uint8Array(await o.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));return {data:'data:'+o.httpMetadata.contentType+';base64,'+btoa(binary)};}
 async remove(actor,input){ensure(input.confirm===true,'CONFIRM_REQUIRED');const id=input.fileId;const meta=await this.store.read('file:'+id);ensure(meta,'NOT_FOUND');
   // Reserve a tombstone under the same catalog CAS used by attachment/game snapshot creation.
   // Historical game assets are permanently reserved before the game document is written.
   await this.engine.updateCatalog(actor,c=>{ensure(!c.questions.some(q=>q.images.some(i=>i.fileId===id)||q.sources.some(s=>s.driveFileId===id||s.fileId===id))&&!c.usedFileIds?.includes(id),'FILE_REFERENCED','問題または過去ゲームが参照中のため削除できません。');c.deletedFiles??=[];if(!c.deletedFiles.includes(id))c.deletedFiles.push(id);c.audit.push({id:uuid(),actor,at:iso(),action:'file.delete_intent',details:{id}});return true;});
   await this.bucket.delete(id);await this.store.put('file:'+id,{...meta.value,deletedAt:iso()});return true;
 }

 async backup(actor,{automatic=false}={}){
   const catalog=await this.engine.catalog();const now=Date.now(),key='backup-lock';
   const acquired=await this.store.mutate(key,doc=>{if(doc.until>now)return{noWrite:true,result:false};if(automatic&&(!catalog.settings.backupEnabled||doc.lastSuccess>now-catalog.settings.backupIntervalHours*3600000))return{noWrite:true,result:false};doc.until=now+300000;return{result:true};},{until:0,lastSuccess:0});
   if(!acquired)return {skipped:true};const id=uuid(),prefix='backups/'+id+'/';
   await this.store.put('backup:'+id,{id,status:'running',actor,automatic,startedAt:iso(),prefix});
   try{
     const snapshot=await this.store.snapshot();snapshot.documents=snapshot.documents.filter(d=>!d.key.startsWith('backup:')&&!d.key.startsWith('restore:')&&!d.key.startsWith('restore-run:')&&!d.key.startsWith('rate:')&&d.key!=='backup-lock'&&d.key!=='backup-scheduler');
     const fileRecords=snapshot.documents.filter(d=>d.key.startsWith('file:')&&!d.value.deletedAt);const files=[];
     for(const record of fileRecords){const original=await this.bucket.get(record.value.id);ensure(original,'BACKUP_MISSING_FILE','参照ファイルが見つからずバックアップを完了できません。');const body=await original.arrayBuffer();const checksum=await hashBytes(body);const copyKey=prefix+'files/'+record.value.id;await this.bucket.put(copyKey,body,{httpMetadata:original.httpMetadata});files.push({original:record.value.id,copyKey,checksum});}
     const manifest={format:'shakai-quiz-backup',version:1,id,createdAt:iso(),snapshot,files};const serialized=JSON.stringify(manifest);await this.bucket.put(prefix+'manifest.json',serialized,{httpMetadata:{contentType:'application/json'}});
     const meta={id,status:'complete',actor,automatic,startedAt:manifest.createdAt,finishedAt:iso(),prefix,checksum:await hash(serialized),files:files.length,documents:snapshot.documents.length};await this.store.put('backup:'+id,meta);
     await this.store.mutate(key,d=>{d.until=0;d.lastSuccess=Date.now();return{result:true};});
     const all=(await this.store.list('backup:')).filter(x=>x.value.status==='complete').sort((a,b)=>b.value.finishedAt.localeCompare(a.value.finishedAt));
     for(const old of all.slice(catalog.settings.backupRetention)){let cursor;do{const objects=await this.bucket.list({prefix:old.value.prefix,cursor});if(objects.objects.length)await this.bucket.delete(objects.objects.map(o=>o.key));cursor=objects.truncated?objects.cursor:undefined;}while(cursor);await this.store.put(old.key,{...old.value,status:'expired'});}
     return meta;
   }catch(error){await this.store.put('backup:'+id,{id,status:'failed',error:String(error.message),prefix,finishedAt:iso()});await this.store.mutate(key,d=>{d.until=0;return{result:true};});throw error;}
 }
 async restoreTest(actor,id){const meta=await this.store.read('backup:'+id);ensure(meta?.value.status==='complete','BACKUP_NOT_COMPLETE');const object=await this.bucket.get(meta.value.prefix+'manifest.json');ensure(object,'BACKUP_MISSING');const serialized=await object.text();ensure(await hash(serialized)===meta.value.checksum,'BACKUP_CHECKSUM');const manifest=JSON.parse(serialized);ensure(manifest.version===1&&manifest.format==='shakai-quiz-backup','BACKUP_VERSION');
   const runId=uuid(),map={};for(const file of manifest.files){const o=await this.bucket.get(file.copyKey);ensure(o,'BACKUP_MISSING_FILE');const body=await o.arrayBuffer();ensure(await hashBytes(body)===file.checksum,'BACKUP_CHECKSUM');const target='restored/'+runId+'/'+file.original;await this.bucket.put(target,body,{httpMetadata:o.httpMetadata});const copied=await this.bucket.get(target);ensure(copied&&await hashBytes(await copied.arrayBuffer())===file.checksum,'RESTORE_VERIFY','復元ファイルの照合に失敗しました。');map[file.original]=target;}
   const rewrite=v=>{if(typeof v==='string')return map[v]??v;if(Array.isArray(v))return v.map(rewrite);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)]));return v;};
   for(const doc of manifest.snapshot.documents){const value=rewrite(doc.value);await this.store.put('restore:'+runId+':'+doc.key,value);const read=await this.store.read('restore:'+runId+':'+doc.key);delete read.value._mutation;delete value._mutation;ensure(JSON.stringify(read.value)===JSON.stringify(value),'RESTORE_VERIFY');}
   // Response/audit history is restored into isolated documents, preserving original records.
   for(const event of manifest.snapshot.events){
     const key='restore:'+runId+':event:'+event.key,value={...event,payload:rewrite(JSON.parse(event.payload))};
     await this.store.put(key,value);const restored=await this.store.read(key);delete restored.value._mutation;
     ensure(JSON.stringify(restored.value)===JSON.stringify(value),'RESTORE_VERIFY','回答・監査履歴の照合に失敗しました。');
   }
   const result={id:runId,backupId:id,actor,verifiedAt:iso(),documents:manifest.snapshot.documents.length,events:manifest.snapshot.events.length,files:manifest.files.length,namespace:'restore:'+runId+':',productionUnchanged:true};await this.store.put('restore-run:'+runId,result);return result;
 }
}
async function hashBytes(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
