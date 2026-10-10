import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLocation, locationFailureCode} from '../public/lib/geolocation.mjs';

const position = {coords: {latitude: 40.632, longitude: 22.945, accuracy: 15}};
function device() {
  const api = {cleared: [], fallbackCount: 0,
    watchPosition(success, error, options) { api.watch = {success, error, options}; return 7; },
    getCurrentPosition(success, error, options) { api.fallbackCount++; api.once = {success, error, options}; },
    clearWatch(id) { api.cleared.push(id); }};
  return api;
}

test('starts native GPS synchronously and accepts its position', async () => {
  const api = device();
  const request = requestLocation(api);
  assert.ok(api.watch, 'native call must happen during the tap');
  assert.equal(api.watch.options.maximumAge, 0);
  api.watch.success(position);
  assert.equal(await request, position);
  assert.deepEqual(api.cleared, [7]);
});

test('a temporary failure must not kill a watch that later obtains a position', async () => {
  const api = device();
  const request = requestLocation(api);
  api.watch.error({code: 2});
  api.once.error({code: 3});
  api.watch.error({code: 3});
  assert.equal(api.fallbackCount, 1);
  assert.deepEqual(api.cleared, []);
  api.watch.success(position);
  assert.equal(await request, position);
  assert.deepEqual(api.cleared, [7]);
});

test('permission refusal stops immediately without another request', async () => {
  const api = device();
  const request = requestLocation(api);
  api.watch.error({code: 1});
  await assert.rejects(request, {code: 1});
  assert.equal(api.fallbackCount, 0);
  assert.deepEqual(api.cleared, [7]);
});

test('network location succeeds while GPS is still acquiring', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const api = device();
  const request = requestLocation(api);
  t.mock.timers.tick(12000);
  const approximate = {coords: {...position.coords, accuracy: 1400}};
  api.once.success(approximate);
  assert.equal(await request, approximate);
  assert.deepEqual(api.cleared, [7]);
});

test('cancellation ignores a late native result', async () => {
  const api = device(), controller = new AbortController();
  const request = requestLocation(api, controller.signal);
  controller.abort();
  api.watch.success(position);
  await assert.rejects(request, {code: 'cancelled'});
  assert.deepEqual(api.cleared, [7]);
});

test('a silent GPS cannot keep the interface busy forever', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const api = device();
  const request = requestLocation(api);
  t.mock.timers.tick(60000);
  await assert.rejects(request, {code: 3});
  assert.deepEqual(api.cleared, [7]);
});

test('invalid coordinates are ignored until a valid fix arrives', async () => {
  const api = device();
  const request = requestLocation(api);
  api.watch.success({coords: {latitude: NaN, longitude: 22, accuracy: 15}});
  api.watch.success(position);
  assert.equal(await request, position);
});

test('browser restrictions are distinguished from a user refusal', () => {
  assert.equal(locationFailureCode({code: 1}), '1');
  assert.equal(locationFailureCode({code: 1}, {embedded: true}), 'embedded');
  assert.equal(locationFailureCode({code: 1}, {policyAllowed: false}), 'policy');
  assert.equal(locationFailureCode({code: 1}, {secure: false}), 'secure');
});
