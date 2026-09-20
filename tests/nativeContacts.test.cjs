const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('functions/src/index.ts', 'utf8');
const start = source.indexOf('// Contact numbers are deliberately separate');
const cleanStart = source.indexOf('const cleanCircleId =');
const cleanEnd = source.indexOf('type SubscriptionTier', cleanStart);
const records = {};
class HttpsError extends Error { constructor(code, message) { super(message); this.code=code; } }
const context = { exports: {}, functions: {
    https: { onCall: fn => fn, HttpsError },
    auth: { user: () => ({ onDelete: fn => fn }) }
}, admin: { database: () => ({ ref: path => ({
    once: async () => ({ val: () => records[path] ?? null }),
    set: async value => { records[path] = value; },
    remove: async () => { delete records[path]; }
}) }) }, Set, Array };
vm.createContext(context);
vm.runInContext(ts.transpile(cleanEnd > cleanStart ? source.slice(cleanStart,cleanEnd)+source.slice(start) : '', { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }),context);
const {getCircleContacts,saveContactPreferences,removeDeletedUserContact}=context.exports;
const circleId='circle_abcdefgh';
const asUser=uid=>({auth:{uid}});
(async()=>{
records['circles/'+circleId]={members:['alice','bob']};
await assert.rejects(()=>getCircleContacts({circleIds:[circleId]},{}),e=>e.code==='unauthenticated');
await assert.rejects(()=>saveContactPreferences({phone:'+19105550123',circleIds:[circleId]},asUser('eve')),e=>e.code==='permission-denied');
await assert.rejects(()=>saveContactPreferences({phone:'tel:123?body=x',circleIds:[]},asUser('alice')),e=>e.code==='invalid-argument');
await saveContactPreferences({phone:'+19105550123',circleIds:[]},asUser('bob'));
assert.equal((await getCircleContacts({circleIds:[circleId]},asUser('alice'))).contacts.bob,undefined);
await saveContactPreferences({phone:'+19105550123',circleIds:[circleId]},asUser('bob'));
assert.equal((await getCircleContacts({circleIds:[circleId]},asUser('alice'))).contacts.bob,'+19105550123');
assert.equal(Object.keys((await getCircleContacts({circleIds:[circleId]},asUser('eve'))).contacts).length,0);
records['circles/'+circleId].members=['alice'];
assert.equal((await getCircleContacts({circleIds:[circleId]},asUser('alice'))).contacts.bob,undefined);
records['circles/'+circleId].members=['alice','bob'];
await saveContactPreferences({phone:'',circleIds:[circleId]},asUser('bob'));
assert.equal((await getCircleContacts({circleIds:[circleId]},asUser('alice'))).contacts.bob,undefined);
await removeDeletedUserContact({uid:'bob'});
assert.equal(records['privateContactPreferences/bob'],undefined);
const nativeSource=fs.readFileSync('services/nativeContactService.ts','utf8');
const launches=[];
const nativeContext={exports:{},window:{location:{href:''}},require:name=>{
if(name==='@capacitor/core')return {Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>({open:async options=>launches.push(options)})};
if(name==='firebase/functions')return {httpsCallable:()=>()=>{}};
if(name==='./firebase')return {functions:{}};
throw Error(name);
}};
vm.createContext(nativeContext);
vm.runInContext(ts.transpile(nativeSource,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),nativeContext);
assert.equal(nativeContext.exports.normalizeContactNumber('+1 (910) 555-0123'),'+19105550123');
assert.throws(()=>nativeContext.exports.normalizeContactNumber('911'));
assert.throws(()=>nativeContext.exports.normalizeContactNumber('+19105550123?body=hello'));
await nativeContext.exports.openNativeContact('+1 (910) 555-0123','text');
await nativeContext.exports.openNativeContact('+19105550123','call');
assert.equal(launches[0].action,'text');assert.equal(launches[1].action,'call');
assert.equal(launches[0].phone,'+19105550123');
console.log('PASS: native action dispatch and phone sanitization');
console.log('PASS: authentication, sharing opt-in, outsider denial, membership revocation, number validation, removal and account cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
