import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationStartup} from '../public/lib/location-startup.mjs';
function memory(){const data=new Map();return {data,getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}

test('first installed launch waits for a tap; browser success cannot enable installed startup',()=>{
 const storage=memory(),browser=createLocationStartup({storage});
 assert.equal(browser.automatic,true);browser.succeeded();
 assert.equal(storage.data.size,0);
 assert.equal(createLocationStartup({standalone:true,storage}).automatic,false);
});
test('successful installed activation enables later startup without storing a position',()=>{
 const storage=memory(),app=createLocationStartup({standalone:true,storage});
 app.succeeded();assert.equal(app.automatic,true);
 assert.deepEqual([...storage.data.values()],['1']);
 assert.equal(createLocationStartup({standalone:true,storage}).automatic,true);
});
test('denial and pause stop subsequent automatic attempts',()=>{
 const storage=memory(),app=createLocationStartup({standalone:true,storage});
 for(const action of ['denied','paused']){
  app.succeeded();app[action]();assert.equal(app.automatic,false);
  assert.equal(createLocationStartup({standalone:true,storage}).automatic,false);
 }
});
test('unavailable local storage does not prevent manual activation',()=>{
 const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 const app=createLocationStartup({standalone:true,storage});
 assert.equal(app.automatic,false);app.succeeded();assert.equal(app.automatic,true);
 app.denied();assert.equal(app.automatic,false);
});
