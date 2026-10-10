import test from 'node:test';
import assert from 'node:assert/strict';
import {isStandalone,locationReport} from '../public/lib/location-context.mjs';
test('home screen mode supports iOS standalone and display-mode without assuming browser permissions',()=>{
 assert.equal(isStandalone({standalone:true}),true);
 assert.equal(isStandalone({displayMode:true}),true);
 assert.equal(isStandalone({standalone:false,displayMode:false}),false);
 assert.equal(isStandalone(),false);
});
test('diagnostic identifies web app without recording coordinates',()=>{
 const r=locationReport({error:{code:1},browser:'Safari',host:'example.test',secure:true,embedded:false,standalone:true,policyAllowed:null,elapsedMs:5,latitude:40,longitude:23});
 assert.match(r,/Web app αρχικής οθόνης/);assert.match(r,/PF-LOC-4/);assert.doesNotMatch(r,/latitude|longitude/);
});
