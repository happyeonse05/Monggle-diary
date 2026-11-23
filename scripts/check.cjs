const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');let checked=0;
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  const src=match[1].match(/src="([^"]+)"/);
  new vm.Script(src?fs.readFileSync(src[1],'utf8'):match[2]);checked++;
}
assert.ok(html.indexOf('src="diary-store.js"')<html.indexOf('MonggleDiaryStore.createStore'));
assert.ok(html.includes('id="saveStatus"'));
console.log('Static app scripts compiled: '+checked+'; required storage asset present');
