import test from 'node:test';
import assert from 'node:assert/strict';
await import('../packages/editor-adapter/beautify.js');
const plan=(globalThis as any).DiagramBeautify.plan;
const a={id:'a',x:0,y:0,width:100,height:60},b={id:'b',x:200,y:5,width:100,height:60};
test('small offsets become a shared straight horizontal anchor without moving nodes',()=>{
 const before=JSON.stringify([a,b]);const [r]=plan([a,b],[{id:'e',source:'a',target:'b'}]);
 assert.equal(r.axis,'horizontal');assert.equal(a.y+r.exitY*a.height,b.y+r.entryY*b.height);assert.equal(r.exitX,1);assert.equal(r.entryX,0);assert.equal(JSON.stringify([a,b]),before);
});
test('vertical offsets, direction and container crossings use absolute coordinates',()=>{
 const nodes=[{...a,ancestors:['container']},{...b,x:8,y:200,ancestors:['container']},{id:'container',x:-20,y:-20,width:400,height:400}];
 const [r]=plan(nodes,[{id:'e',source:'b',target:'a'}]);assert.equal(r.axis,'vertical');assert.equal(r.exitY,0);assert.equal(r.entryY,1);assert.equal(8+r.exitX*100,r.entryX*100);
});
test('obstacles, locks, self loops and non-overlapping projections keep existing routes',()=>{
 assert.equal(plan([a,b,{id:'c',x:130,y:0,width:30,height:60}],[{id:'e',source:'a',target:'b'}]).length,0);
 assert.equal(plan([a,b],[{id:'e',source:'a',target:'b',locked:true}]).length,0);
 assert.equal(plan([a,{...b,locked:true}],[{id:'e',source:'a',target:'b'}]).length,0);
 assert.equal(plan([a,b],[{id:'e',source:'a',target:'a'}]).length,0);
 assert.equal(plan([a,{...b,y:200}],[{id:'e',source:'a',target:'b'}]).length,0);
});
