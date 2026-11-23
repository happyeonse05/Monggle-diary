const test=require('node:test');
const assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore,IDBDatabase}=require('fake-indexeddb');
const {createStore,createSaver,diaryKey}=require('../diary-store.js');
const job=(date,memo)=>({key:'dy:'+date,monthKey:'dm:'+date.slice(0,7),day:{pages:[{memo,items:[],strokes:[],paper:'#fff'}],weather:null,mood:null},summary:{c:'#fff',n:1,w:null,m:null}});

test('realistic IndexedDB transactions persist diary, monthly summary and unknown page fields across reopen',async()=>{
  const factory=new IDBFactory(),s=createStore(factory),j=job('2026-11-24','Synthetic');j.day.pages[0].future={keep:true};
  await s.saveDay(j);await s.set('pen:prefs',{colors:['#fff']});await s.close();
  const reopened=createStore(factory);
  assert.deepEqual(await reopened.get(j.key),j.day);assert.deepEqual(await reopened.get(j.monthKey),{'24':j.summary});
  assert.deepEqual(await reopened.get('pen:prefs'),{colors:['#fff']});await reopened.close();
});

test('abort after diary request succeeds rolls back diary and calendar together, then retry succeeds',async()=>{
  const s=createStore(new IDBFactory()),before=job('2026-11-24','old');await s.saveDay(before);
  const original=IDBObjectStore.prototype.put;let aborted=false;
  IDBObjectStore.prototype.put=function(value,key){const r=original.call(this,value,key),tx=this.transaction;if(key===before.key&&!aborted){aborted=true;r.addEventListener('success',()=>tx.abort());}return r};
  try{await assert.rejects(s.saveDay(job('2026-11-24','new')))}finally{IDBObjectStore.prototype.put=original}
  assert.equal(aborted,true);assert.deepEqual(await s.get(before.key),before.day);assert.deepEqual(await s.get(before.monthKey),{'24':before.summary});
  await s.saveDay(job('2026-11-24','retry'));assert.equal((await s.get(before.key)).pages[0].memo,'retry');await s.close();
});

test('saving a second date keeps the first date and monthly markers, empty content removes only its marker',async()=>{
  const s=createStore(new IDBFactory());await s.saveDay(job('2026-11-23','one'));await s.saveDay(job('2026-11-24','two'));
  const empty=job('2026-11-24','');empty.summary=null;await s.saveDay(empty);
  assert.equal((await s.get('dy:2026-11-23')).pages[0].memo,'one');assert.deepEqual(Object.keys(await s.get('dm:2026-11')),['23']);await s.close();
});

test('failed reads lock writes for that store instance rather than overwriting unread records',async()=>{
  const f=new IDBFactory(),s=createStore(f),j=job('2026-11-24','preserve');await s.saveDay(j);
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(names,mode,...args){if(mode==='readonly')throw Error('Synthetic read failure');return original.call(this,names,mode,...args)};
  try{await assert.rejects(s.get(j.key))}finally{IDBDatabase.prototype.transaction=original}
  await assert.rejects(s.saveDay(job('2026-11-24','bad')),/failed read/);await s.close();
  const fresh=createStore(f);assert.deepEqual(await fresh.get(j.key),j.day);await fresh.close();
});

test('missing storage, credential keys, mismatched dates and malformed monthly data fail closed',async()=>{
  const unavailable=createStore(undefined);await assert.rejects(unavailable.saveDay(job('2026-11-24','no')));
  const s=createStore(new IDBFactory());
  for(const key of ['session','sb:session','acct:someone@example.test','u:someone:dy:2026-11-24']){
    assert.equal(diaryKey(key),false);await assert.rejects(s.set(key,{private:'synthetic'}));
  }
  await assert.rejects(s.saveDay({...job('2026-11-24','bad'),monthKey:'dm:2026-10'}));
  await s.set('dm:2026-11',[]);await assert.rejects(s.saveDay(job('2026-11-24','bad')));
  assert.equal(await s.get('dy:2026-11-24'),null);assert.deepEqual(await s.get('dm:2026-11'),[]);await s.close();
});

test('scheduler freezes date/content, saves multiple navigated dates and reports success only after writes',async()=>{
  const writes=[],states=[];let release;const gate=new Promise(ok=>release=ok);
  const saver=createSaver(async j=>{await gate;writes.push(j)},s=>states.push(s),60000);
  const first=job('2026-11-23','before navigation');saver.schedule(first);first.day.pages[0].memo='mutated';
  saver.schedule(job('2026-11-24','another day'));const work=saver.flush();await new Promise(ok=>setImmediate(ok));
  assert.equal(states.at(-1),'saving');assert.equal(writes.length,0);release();await work;
  assert.deepEqual(writes.map(x=>[x.key,x.day.pages[0].memo]),[['dy:2026-11-23','before navigation'],['dy:2026-11-24','another day']]);assert.equal(states.at(-1),'saved');
});

test('failed scheduled writes stay retryable; newer content supersedes a failed snapshot',async()=>{
  const states=[],writes=[];let fail=true;
  const saver=createSaver(async j=>{if(fail)throw Error('Synthetic quota');writes.push(j)},s=>states.push(s),60000);
  saver.schedule(job('2026-11-24','old'));assert.equal(await saver.flush(),false);assert.equal(states.at(-1),'error');
  saver.schedule(job('2026-11-24','new'));fail=false;assert.equal(await saver.flush(),true);
  assert.equal(writes.length,1);assert.equal(writes[0].day.pages[0].memo,'new');assert.equal(states.at(-1),'saved');
});
