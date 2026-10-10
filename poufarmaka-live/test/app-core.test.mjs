import test from 'node:test';
import assert from 'node:assert/strict';
import {cityFor,validPoint,rankRoutes,escapeHtml,safeUrl} from '../public/lib/app-core.mjs';
import {openAt,parseHours,localEpoch,localDate} from '../public/lib/domain.mjs';
test('source selection includes Patra and Larisa, not just Athens and Thessaloniki',()=>{
 assert.equal(cityFor({lat:38.24,lng:21.73}).key,'patra');
 assert.equal(cityFor({lat:39.64,lng:22.42}).key,'larisa');
 assert.equal(cityFor({lat:40.47,lng:22.99}).key,'thessaloniki');
 assert.equal(validPoint({lat:NaN,lng:22}),false);
});
test('route ranking prioritises reachable pharmacies; null time is not zero',()=>{
 const now=Date.now(),row=(id,km,end)=>({id,km,open:true,intervals:[{start:now-1000,end}]});
 const rows=[row('near-but-closes',.2,now+400000),row('reachable',1,now+3600000),row('no-route',.1,now+3600000)];
 const ranked=rankRoutes(rows,[{seconds:180},{seconds:400},{seconds:null}],now);
 assert.equal(ranked[0].id,'reachable');assert.equal(ranked[2].seconds,null);
 assert.equal(rankRoutes(rows,[],now,'distance')[0].id,'no-route');
});
test('overnight duty remains open after midnight, then closes at its exact boundary',()=>{
 const date=localDate(),intervals=parseHours('21:00 - 08:00',date),row={verified:true,fetchedAt:new Date().toISOString(),updateCadence:'daily',intervals};
 assert.ok(openAt(row,localEpoch(date,25*60)));assert.equal(openAt(row,intervals[0].end),false);
 assert.equal(openAt({...row,intervals:[]},Date.now()),false);
 assert.equal(openAt({...row,fetchedAt:'2020-01-01T00:00:00Z'},localEpoch(date,25*60)),false);
});
test('source and popup content cannot inject markup or JavaScript URLs',()=>{
 assert.equal(escapeHtml('<img src=x onerror="x">'),'&lt;img src=x onerror=&quot;x&quot;&gt;');
 assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('https://example.org/'),'https://example.org/');
});
