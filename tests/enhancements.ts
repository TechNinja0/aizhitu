import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {startServer} from '../apps/local-server/server.ts';import {validate} from '../packages/document-core/index.ts';
const server=await startServer({port:0}),browser=await chromium.launch({channel:'chromium'}),page=await browser.newPage({viewport:{width:1600,height:1000}});const checks:string[]=[];
const check=(s:string)=>{checks.push(s);console.log('PASS',s);};
try{
 await page.goto(server.origin);await page.getByText('9 个节点 · 6 条连线').waitFor();const frame=page.frames()[1];const invoke=(method:string,args:any={})=>frame.evaluate(({method,args})=>(window as any).workbench.invoke(method,args),{method,args});
 const original=await invoke('snapshot');await page.getByRole('button',{name:'✦ 一键美化'}).click();await page.waitForTimeout(450);const styled=await invoke('snapshot');assert.ok(styled.revision>original.revision);
 const before=validate(original.xml),after=validate(styled.xml);assert.equal(after.ok,true,JSON.stringify(after.errors));
 assert.deepEqual(before.cells!.filter(c=>c.kind==='node'),after.cells!.filter(c=>c.kind==='node'));
 assert.deepEqual(before.cells!.filter(c=>c.kind==='edge').map(c=>[c.id,c.label,c.source,c.target]),after.cells!.filter(c=>c.kind==='edge').map(c=>[c.id,c.label,c.source,c.target]));
 await invoke('action',{name:'undo'});assert.equal(validate((await invoke('snapshot')).xml).contentHash,before.contentHash);check('beautify preserves all nodes and semantics, and one undo restores all routes');
 await invoke('beautify');const first=await invoke('snapshot');assert.equal((await invoke('beautify')).beautified,0);assert.equal((await invoke('snapshot')).revision,first.revision);check('beautify is idempotent');
 await invoke('load',{xml:original.xml});const base=await invoke('snapshot');const candidate=original.xml.replace('value="订单服务"','value="订单处理服务"');
 const review=await(await fetch(server.origin+'/api/diff',{method:'POST',headers:{Authorization:'Bearer '+server.token,'Content-Type':'application/json'},body:JSON.stringify({baseXml:original.xml,candidateXml:candidate})})).json();
 const applied=await invoke('applyCandidate',{xml:review.candidateXml,expectedRevision:base.revision,documentId:base.metadata.documentId});assert.ok(applied.xml.includes('订单处理服务'));await invoke('action',{name:'undo'});assert.equal(validate((await invoke('snapshot')).xml).contentHash,before.contentHash);check('candidate apply is one undoable edit');
 await assert.rejects(invoke('applyCandidate',{xml:review.candidateXml,expectedRevision:base.revision,documentId:base.metadata.documentId}),/过期/);check('stale candidate revisions are rejected');
 await page.screenshot({path:'artifacts/enhancements.png'});await fs.writeFile('artifacts/enhancements-results.json',JSON.stringify({ok:true,checks},null,2));
}finally{await browser.close();await server.close();}
