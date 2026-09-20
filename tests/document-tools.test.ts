import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {compareDocuments} from '../packages/document-tools/diff.ts';
import {embedSource,extractSource} from '../packages/document-tools/embedded.ts';
import {validate} from '../packages/document-core/index.ts';
const xml=fs.readFileSync('fixtures/examples/flow.drawio','utf8');
test('object diff identifies text, route geometry and style without inventing unrelated changes',()=>{
 const updated=xml.replace('value="资料校验"','value="完整性校验"').replace('x="450" y="290"','x="500" y="290"');
 const d=compareDocuments(xml,updated);assert.equal(d.sameDocument,true);assert.deepEqual(d.changes.map(c=>[c.id,c.kind]),[['check','文字'],['fix','位置/尺寸/折点']]);assert.equal(compareDocuments(xml,xml).changes.length,0);
});
test('embedded SVG restores the exact editable graph and rejects ordinary screenshots',()=>{
 const svg=embedSource(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),'svg',xml);assert.equal(extractSource(svg).contentHash,validate(xml).contentHash);assert.throws(()=>extractSource(Buffer.from('<svg/>')),/没有内嵌/);
});
test('embedded PNG round trip checks metadata CRC and rejects damage',()=>{
 const png=fs.readFileSync('fixtures/benchmark/images/01-flow.png');const embedded=embedSource(png,'png',xml);assert.equal(extractSource(embedded).contentHash,validate(xml).contentHash);const damaged=Buffer.from(embedded);damaged[40]^=1;assert.throws(()=>extractSource(damaged),/校验/);
});

test('candidate baseline identity includes review metadata, not only visible objects',async()=>{const {DOMParser,XMLSerializer}=await import('@xmldom/xmldom');const d=new DOMParser().parseFromString(xml,'text/xml');const root=Array.from(d.getElementsByTagName('object')).find(c=>c.getAttribute('id')==='0')!;const meta=JSON.parse(root.getAttribute('dw_meta')!);meta.provenance={audit:'changed'};root.setAttribute('dw_meta',JSON.stringify(meta));const modified=new XMLSerializer().serializeToString(d);const a=compareDocuments(xml,xml),b=compareDocuments(modified,xml);assert.equal(a.changes.length,b.changes.length);assert.notEqual(a.baseHash,b.baseHash);});

test('normalized font and equivalent style/geometry serialization keep candidate baseline stable',()=>{
 const raw=xml.replaceAll('fontFamily=Noto Sans SC','fontFamily=Arial');
 const normalized=validate(raw);assert.equal(normalized.ok,true);
 assert.equal(compareDocuments(normalized.xml!,xml).baseHash,compareDocuments(raw,xml).baseHash);
 const reordered=xml.replace('x="450" y="290"','y="290.0" x="450.00"');
 assert.equal(validate(reordered).contentHash,validate(xml).contentHash);
 assert.notEqual(validate(xml.replace('x="450" y="290"','x="451" y="290"')).contentHash,validate(xml).contentHash);
});

test('style canonicalization ignores property order but preserves named style override order',async()=>{
 const {canonicalStyle,canonical}=await import('../packages/document-core/index.ts');
 assert.deepEqual(canonical(canonicalStyle('fillColor=#ffffff;strokeColor=#000000;')),canonical(canonicalStyle('strokeColor=#000000;fillColor=#ffffff;')));
 assert.notDeepEqual(canonical(canonicalStyle('ellipse;rounded=1;')),canonical(canonicalStyle('rounded=1;ellipse;')));
});
