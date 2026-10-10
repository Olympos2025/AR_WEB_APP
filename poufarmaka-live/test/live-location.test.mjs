import test from 'node:test';
import assert from 'node:assert/strict';
import {watchLocation,shouldRefreshSearch} from '../public/lib/live-location.mjs';
const position=(latitude=40,longitude=23,accuracy=10)=>({coords:{latitude,longitude,accuracy}});
function device(){const api={cleared:[],watchPosition(success,error,options){api.success=success;api.error=error;api.options=options;return 42},clearWatch(id){api.cleared.push(id)}};return api}
test('movement updates remain subscribed after the first fix and stop on cancel',()=>{
 const api=device(),signal=new AbortController(),updates=[];
 watchLocation(api,{signal:signal.signal,onPosition:p=>updates.push(p),onError:()=>{}});
 api.success(position());api.success(position(40.001));api.success(position(40.002));
 assert.equal(updates.length,3);assert.deepEqual(api.cleared,[]);
 signal.abort();api.success(position(40.003));assert.equal(updates.length,3);assert.deepEqual(api.cleared,[42]);
});
test('temporary loss recovers, revoked permission stops future updates',()=>{
 const api=device(),updates=[],errors=[];
 watchLocation(api,{onPosition:p=>updates.push(p),onError:e=>errors.push(e.code)});
 api.error({code:3});api.success(position());api.error({code:1});api.success(position(40.002));
 assert.deepEqual(errors,[3,1]);assert.equal(updates.length,1);assert.deepEqual(api.cleared,[42]);
});
test('invalid positions and pre-aborted subscriptions never produce movement',()=>{
 const api=device(),updates=[];
 const stop=watchLocation(api,{onPosition:p=>updates.push(p),onError:()=>{}});
 api.success(position(NaN));api.success(position(95));api.success(position(40,23,-1));assert.equal(updates.length,0);stop();
 const aborted=new AbortController();aborted.abort();const untouched=device();
 watchLocation(untouched,{signal:aborted.signal,onPosition:()=>assert.fail(),onError:()=>assert.fail()});assert.equal(untouched.success,undefined);
});
test('search refresh limits GPS jitter while allowing meaningful walking or driving movement',()=>{
 const previous={position:{lat:40,lng:23,accuracy:10},at:0};
 assert.equal(shouldRefreshSearch(null,previous.position,0),true);
 assert.equal(shouldRefreshSearch(previous,{lat:40.00001,lng:23,accuracy:10},30000),false);
 assert.equal(shouldRefreshSearch(previous,{lat:40.001,lng:23,accuracy:10},1000),false);
 assert.equal(shouldRefreshSearch(previous,{lat:40.001,lng:23,accuracy:10},6000),true);
 assert.equal(shouldRefreshSearch(previous,{lat:40.0002,lng:23,accuracy:10},16000),true);
});
