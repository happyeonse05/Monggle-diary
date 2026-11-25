const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(process.env.DIARY_HTML||require('node:path').join(__dirname,'../index.html'),'utf8');
function section(start,end){const i=html.indexOf(start);assert.ok(i>=0,start);const j=html.indexOf(end,i);assert.ok(j>i,end);return html.slice(i,j)}
function fixture(){
  const elements={},requests=[],writes=[],rendered=[];
  const $=id=>elements[id]||(elements[id]={inert:false,readOnly:false,hidden:true,textContent:'',value:'old memo',attributes:{},setAttribute(k,v){this.attributes[k]=v}});
  let commits=0;
  const c={Promise,D:{key:'2026-11-20',pages:[{memo:'old memo'}]},K:k=>k,$,
    blankPage:()=>({memo:'',items:[],strokes:[],paper:'#fff',pattern:'line'}),
    store:{get(key){return new Promise((resolve,reject)=>requests.push({key,resolve,reject}))}},
    setPage(i){rendered.push(c.D.pages[i]);$('bodyMemo').value=c.D.pages[i].memo||''},
    commitPage(){commits++},guestKey:()=>true,diarySaver:{schedule:j=>writes.push(j)},
    setTimeout(){throw Error('Unexpected legacy timer')},clearTimeout(){}};
  vm.createContext(c);
  vm.runInContext('var saveT, dayLoadSeq=0, dayLoading=false;\n'+section('function saveDay(){','function blankPage()')+section('function loadDay(key){','function setPage(i){'),c);
  // dayLoadState is deliberately next to loadDay and included above.
  return {c,$,requests,writes,rendered,get commits(){return commits}};
}
const tick=()=>new Promise(ok=>setImmediate(ok));
const day=memo=>({weather:'sun',mood:'happy',pages:[{memo,items:[],strokes:[],future:{kept:true}}]});

test('later date wins when an earlier read finishes last; subsequent save uses the correct payload',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21'),b=f.c.loadDay('2026-11-22');await tick();
  f.requests[1].resolve(day('B'));await b;f.requests[0].resolve(day('A'));await a;
  assert.equal(f.c.D.key,'2026-11-22');assert.equal(f.$('bodyMemo').value,'B');assert.equal(f.rendered.length,1);
  f.c.saveDay();assert.equal(f.writes[0].key,'dy:2026-11-22');assert.equal(f.writes[0].day.pages[0].memo,'B');
});
test('a repeated request for the same date also ignores the older response',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21'),b=f.c.loadDay('2026-11-21');await tick();
  f.requests[1].resolve(day('new'));await b;f.requests[0].resolve(day('old'));await a;
  assert.equal(f.$('bodyMemo').value,'new');assert.equal(f.rendered.length,1);
});
test('loading synchronously blocks editing, export and saves before any asynchronous read',async()=>{
  const f=fixture(),p=f.c.loadDay('2026-11-21');f.c.saveDay();
  assert.equal(f.commits,0);assert.equal(f.writes.length,0);
  for(const id of ['book','dockwrap','undoBtn','redoBtn','saveBtn'])assert.equal(f.$(id).inert,true,id);
  assert.equal(f.$('bodyMemo').readOnly,true);assert.equal(f.$('book').attributes['aria-busy'],'true');assert.equal(f.$('dayLoadStatus').hidden,false);
  await tick();f.requests[0].resolve(day('loaded'));await p;
  assert.equal(f.$('bodyMemo').readOnly,false);assert.equal(f.$('book').inert,false);assert.equal(f.$('dayLoadStatus').hidden,true);
  f.c.saveDay();assert.equal(f.commits,1);assert.equal(f.writes.length,1);
});
test('an obsolete success cannot unlock an outstanding current request',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21'),b=f.c.loadDay('2026-11-22');await tick();
  f.requests[0].resolve(day('A'));await a;f.c.saveDay();assert.equal(f.writes.length,0);assert.equal(f.$('book').inert,true);assert.equal(f.rendered.length,0);
  f.requests[1].resolve(day('B'));await b;assert.equal(f.$('book').inert,false);
});
test('an obsolete rejection cannot relock or change the current successful day',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21'),b=f.c.loadDay('2026-11-22');await tick();
  f.requests[1].resolve(day('B'));await b;f.requests[0].reject(Error('synthetic old failure'));await a;
  assert.equal(f.$('bodyMemo').value,'B');assert.equal(f.$('book').inert,false);assert.equal(f.$('dayLoadStatus').hidden,true);
});
test('a current rejection keeps prior content locked and protected from writes',async()=>{
  const f=fixture(),p=f.c.loadDay('2026-11-21');await tick();f.requests[0].reject(Error('synthetic read failure'));await p;
  assert.equal(f.$('bodyMemo').value,'old memo');assert.equal(f.$('book').inert,true);assert.match(f.$('dayLoadStatus').textContent,/읽지 못/);
  f.c.saveDay();assert.equal(f.commits,0);assert.equal(f.writes.length,0);assert.equal(f.rendered.length,0);
});
test('an older success after a current rejection cannot replace or unlock the editor',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21'),b=f.c.loadDay('2026-11-22');await tick();
  f.requests[1].reject(Error('synthetic current failure'));await b;f.requests[0].resolve(day('A'));await a;
  f.c.saveDay();assert.equal(f.rendered.length,0);assert.equal(f.$('book').inert,true);assert.equal(f.writes.length,0);
});
test('synchronous storage exceptions also leave the editor locked',async()=>{
  const f=fixture();f.c.store.get=()=>{throw Error('synthetic synchronous failure')};await f.c.loadDay('2026-11-21');
  assert.equal(f.$('book').inert,true);assert.match(f.$('dayLoadStatus').textContent,/읽지 못/);f.c.saveDay();assert.equal(f.writes.length,0);
});
test('a new successful load can recover after a rejected load',async()=>{
  const f=fixture(),a=f.c.loadDay('2026-11-21');await tick();f.requests[0].reject(Error('synthetic transient failure'));await a;
  const b=f.c.loadDay('2026-11-22');assert.match(f.$('dayLoadStatus').textContent,/불러오는/);await tick();f.requests[1].resolve(day('B'));await b;
  assert.equal(f.$('book').inert,false);assert.equal(f.$('bodyMemo').value,'B');
});
test('a storage account prefix change cannot apply a response from the earlier scope',async()=>{
  const f=fixture();let prefix='guest:';f.c.K=k=>prefix+k;const p=f.c.loadDay('2026-11-21');await tick();prefix='other:';
  f.requests[0].resolve(day('private old scope'));await p;assert.equal(f.rendered.length,0);assert.equal(f.$('book').inert,true);f.c.saveDay();assert.equal(f.writes.length,0);
});
test('normal current, legacy and missing days still load without discarding unknown page fields',async()=>{
  for(const payload of [day('normal'),{memo:'legacy',paper:'#abc',items:[{id:'one'}]},null]){
    const f=fixture(),p=f.c.loadDay('2026-11-21');await tick();f.requests[0].resolve(payload);await p;
    assert.equal(f.$('bodyMemo').value,payload?(payload.pages?payload.pages[0].memo:payload.memo):'');assert.equal(f.$('book').inert,false);
    if(payload?.pages)assert.deepEqual(f.c.D.pages,payload.pages);
  }
});

test('a render exception leaves the current editor locked rather than enabling saves',async()=>{
  const f=fixture();f.c.setPage=()=>{throw Error('synthetic render failure')};const p=f.c.loadDay('2026-11-21');await tick();f.requests[0].resolve(day('B'));await p;
  assert.equal(f.$('book').inert,true);assert.match(f.$('dayLoadStatus').textContent,/읽지 못/);f.c.saveDay();assert.equal(f.writes.length,0);
});
