import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabSwipe } from '../src/ui/tabSwipe.ts';
const p=(x:number,y=200,time=0)=>({x,y,time});
test('horizontal touch navigates adjacent tabs in both directions without wrapping',()=>{
 const forward=createTabSwipe('/');forward.begin(p(300),390,false);assert.equal(forward.move(p(220,205,100)),true);assert.equal(forward.end(p(190,205,200)),'/expenses');
 const back=createTabSwipe('/tasks');back.begin(p(100),390,false);back.move(p(200,202,100));assert.equal(back.end(p(220,202,200)),'/expenses');
 const edge=createTabSwipe('/');edge.begin(p(100),390,false);assert.equal(edge.move(p(220,202,100)),false);assert.equal(edge.end(p(250,202,200)),null);
 const last=createTabSwipe('/group');last.begin(p(300),390,false);assert.equal(last.move(p(180,200,100)),false);assert.equal(last.end(p(100,200,200)),null);
});
test('vertical gesture stays scrolling even when it later moves horizontally',()=>{
 const swipe=createTabSwipe('/');swipe.begin(p(300),390,false);assert.equal(swipe.move(p(298,225,50)),false);assert.equal(swipe.move(p(180,230,150)),false);assert.equal(swipe.end(p(100,230,200)),null);
});
test('controls, browser edges, multiple fingers, long presses and small taps never navigate',()=>{
 for(const {x,blocked,touches} of [{x:10,blocked:false,touches:1},{x:380,blocked:false,touches:1},{x:300,blocked:true,touches:1},{x:300,blocked:false,touches:2}]){
  const swipe=createTabSwipe('/');swipe.begin(p(x),390,blocked,touches);assert.equal(swipe.move(p(100,200,100)),false);assert.equal(swipe.end(p(80,200,200)),null);
 }
 const small=createTabSwipe('/');small.begin(p(300),390,false);small.move(p(275,200,100));assert.equal(small.end(p(270,200,200)),null);
 const held=createTabSwipe('/');held.begin(p(300),390,false);assert.equal(held.move(p(100,200,1000)),false);assert.equal(held.end(p(80,200,1100)),null);
 const multitouch=createTabSwipe('/');multitouch.begin(p(300),390,false);multitouch.move(p(250,200,100));multitouch.move(p(200,200,150),2);assert.equal(multitouch.end(p(100,200,200)),null);
});
test('detail routes and cancelled gestures never change tabs',()=>{
 const detail=createTabSwipe('/alarm/new');detail.begin(p(300),390,false);assert.equal(detail.move(p(200,200,100)),false);assert.equal(detail.end(p(100,200,200)),null);
 const cancelled=createTabSwipe('/');cancelled.begin(p(300),390,false);cancelled.move(p(200,200,100));cancelled.cancel();assert.equal(cancelled.end(p(100,200,200)),null);
});
