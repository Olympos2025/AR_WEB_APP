import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchArea} from '../public/lib/search-area.mjs';
import {rankPlaces} from '../public/lib/place-ranking.mjs';
import {localDate} from '../public/lib/domain.mjs';

const origin = {lat:40.4680227, lng:22.9944764}; // Public locality centre, not a device position.
const time = Date.now();
const filters = {origin, radius:5, kind:'pharmacy', time, onlyOpen:true, night:false, specialty:''};
const record = {id:'test', facilityId:'test', kind:'pharmacy', lat:40.542984, lng:23.01864,
  date:localDate(time), fetchedAt:new Date(time).toISOString(), updateCadence:'daily', verified:true,
  intervals:[{start:time-3600000, end:time+3600000}]};

test('an empty 5 km search in Kardia shows the available active record at 8.6 km', () => {
  const result = searchArea([record], filters);
  assert.equal(result.expanded, true);
  assert.equal(result.radius, 10);
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].km > 8 && result.rows[0].km < 9);
});
test('populated nearby searches stop at 5 km even if farther records exist', () => {
  const nearby = {...record, ...origin};
  assert.equal(searchArea([nearby, record], filters).expanded, false);
  assert.equal(searchArea([nearby, record], filters).rows.length, 1);
});
test('expansion never admits stale, closed, unverified or out-of-range entries', () => {
  for (const change of [
    {fetchedAt:new Date(time-27*3600000).toISOString()},
    {intervals:[{start:time-7200000,end:time-1}]},
    {verified:false}, {lat:39.64,lng:22.42}
  ]) assert.equal(searchArea([{...record,...change}], filters).rows.length, 0);
  assert.equal(searchArea([record], {...filters,night:true}).rows.length, 0);
});
test('an exact locality match precedes a closer street containing its name', () => {
  const street = {...origin, label:'Θεσσαλονίκης - Καρδίας, Νέο Ρύσιο'};
  const locality = {...origin, lat:40.46, label:'Καρδία, 575 00'};
  assert.equal(rankPlaces([street,locality], 'καρδια', origin)[0], locality);
});

test('uses 50 km directly after empty 5 and 10 km, never 15 or 25', () => {
 const far={...record,lat:origin.lat+.18,lng:origin.lng};
 const result=searchArea([far],filters);
 assert.equal(result.radius,50);assert.equal(result.rows.length,1);
});
test('no results reports the full 50 km search; a new nearby fix resets to 5',()=>{
 assert.equal(searchArea([],filters).radius,50);
 assert.equal(searchArea([record],{...filters,origin:record}).radius,5);
});
