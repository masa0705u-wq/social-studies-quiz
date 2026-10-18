export class QuizError extends Error {
  constructor(code, message=code, status=400) {super(message);this.code=code;this.status=status;}
}
export function ensure(ok,code,message=code,status=400){if(!ok)throw new QuizError(code,message,status);}
export class Store {
  constructor(db){this.db=db;}
  async read(key){const row=await this.db.prepare('SELECT version,data FROM quiz_documents WHERE key=?').bind(key).first();return row?{version:row.version,value:JSON.parse(row.data)}:null;}
  async list(prefix=''){const result=await this.db.prepare('SELECT key,version,data FROM quiz_documents WHERE key LIKE ? ORDER BY key').bind(prefix+'%').all();return result.results.map(r=>({key:r.key,version:r.version,value:JSON.parse(r.data)}));}
  async event(key){const row=await this.db.prepare('SELECT payload FROM quiz_events WHERE key=?').bind(key).first();return row?JSON.parse(row.payload):null;}
  async events(gameId){const r=await this.db.prepare('SELECT key,kind,payload,created_at FROM quiz_events WHERE game_id=? ORDER BY created_at,key').bind(gameId).all();return r.results.map(row=>({...row,payload:JSON.parse(row.payload)}));}
  /** @param {string} key @param {Function} fn @param {any} [initial] */
  async mutate(key,fn,initial=null){
    for(let attempt=0;attempt<8;attempt++){
      const current=await this.read(key);const value=structuredClone(current?.value??initial);
      const outcome=await fn(value);if(outcome.noWrite)return outcome.result;
      const tag=crypto.randomUUID(),date=new Date().toISOString();value._mutation=tag;
      const data=JSON.stringify(value);ensure(new TextEncoder().encode(data).length<1500000,'DOCUMENT_LIMIT','保存容量の上限です。内容を整理してください。',413);
      const update=current?this.db.prepare('UPDATE quiz_documents SET version=version+1,data=?,updated_at=? WHERE key=? AND version=?').bind(data,date,key,current.version):
        this.db.prepare('INSERT OR IGNORE INTO quiz_documents(key,version,data,updated_at) VALUES(?,1,?,?)').bind(key,data,date);
      const statements=[update];
      for(const event of outcome.events||[]){statements.push(this.db.prepare("INSERT INTO quiz_events(key,game_id,kind,payload,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_documents WHERE key=? AND json_extract(data,'$._mutation')=?)").bind(event.key,event.gameId||'',event.kind,JSON.stringify(event.payload),date,key,tag));}
      const results=await this.db.batch(statements);
      if(results[0].meta.changes===1)return outcome.result;
    }
    throw new QuizError('BUSY','回答が集中しています。同じ送信のまま再試行してください。',409);
  }
  async put(key,value){return this.mutate(key,doc=>{Object.keys(doc).forEach(k=>delete doc[k]);Object.assign(doc,value);return{result:true};},{});}
  async snapshot(){const docs=await this.list('');const r=await this.db.prepare('SELECT key,game_id,kind,payload,created_at FROM quiz_events ORDER BY created_at,key').all();return{documents:docs,events:r.results};}
}
