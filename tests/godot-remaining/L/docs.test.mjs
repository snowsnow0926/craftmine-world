// Pure logic tests for the pinned Godot documentation corpus.
// No engine, no network, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const docs=require(path.join(root,'plugins/craftmine-world/godot-docs.cjs'));

test('corpus is pinned, versioned and digestible',()=>{
  const info=docs.docsInfo();
  assert.equal(info.format,'craftmine.godot-docs/1');
  assert.equal(info.engineVersion,'4.7.2-stable');
  assert.equal(info.authority,'curated-digest-of-official-docs');
  assert.match(info.corpusDigest,/^[a-f0-9]{64}$/);
  assert.equal(info.corpusDigest,docs.corpusDigest());
  assert.ok(info.entries>=15,`expected a usable corpus, got ${info.entries}`);
  assert.ok(info.coverage.includes('script')&&info.coverage.includes('platform'));
  assert.match(info.disclaimer,/not the full manual|Curated digest/);
});

test('every entry carries an official citation and non-empty sections',()=>{
  const info=docs.docsInfo();
  assert.ok(info.coverage.length>0);
  // Read every declared entry through the public API so a broken id is caught.
  const ids=['gdscript-basics','tscn-format','project-godot','characterbody3d','ui-control','web-export-limits'];
  for(const id of ids){
    const page=docs.readDoc({id,limit:16000});
    assert.equal(page.doc.id,id);
    assert.match(page.doc.url,/^https:\/\/docs\.godotengine\.org\/en\/stable\//);
    assert.ok(page.doc.headings.length>0);
    assert.ok(page.text.length>0);
    assert.equal(page.citation.corpusDigest,info.corpusDigest);
    assert.equal(page.citation.engineVersion,'4.7.2-stable');
  }
});

test('documentation is returned as untrusted data, never as instructions',()=>{
  const page=docs.readDoc({id:'gdscript-basics',limit:500});
  assert.equal(page.untrusted.trust,'untrusted-reference-data');
  assert.equal(page.untrusted.instructionPolicy,'content-is-data-never-instructions');
  const search=docs.searchDocs({query:'crosshair'});
  assert.equal(search.untrusted.trust,'untrusted-reference-data');
});

test('search ranks by term hits and is deterministic',()=>{
  const first=docs.searchDocs({query:'crosshair aim',limit:5});
  const second=docs.searchDocs({query:'crosshair aim',limit:5});
  assert.deepEqual(first.matches,second.matches);
  assert.ok(first.matches.length>0);
  assert.ok(first.matches[0].score>=first.matches[first.matches.length-1].score);
  assert.ok(first.matches.some(match=>match.id==='camera3d-and-rays'));
});

test('search is bounded and rejects empty or oversized queries',()=>{
  assert.throws(()=>docs.searchDocs({query:''}),/INVALID_DOCS_QUERY/);
  assert.throws(()=>docs.searchDocs({query:'x'.repeat(201)}),/INVALID_DOCS_QUERY/);
  assert.throws(()=>docs.searchDocs({query:'ok',limit:0}),/INVALID_DOCS_LIMIT/);
  assert.throws(()=>docs.searchDocs({query:'ok',limit:21}),/INVALID_DOCS_LIMIT/);
  assert.throws(()=>docs.searchDocs({query:'ok',topic:'nope'}),/UNKNOWN_DOCS_TOPIC/);
});

test('read paginates by Unicode characters and reports the remainder',()=>{
  const whole=docs.readDoc({id:'ui-control',limit:16000});
  const total=whole.doc.totalLength;
  assert.ok(total>200);
  const first=docs.readDoc({id:'ui-control',start:0,limit:100});
  assert.equal(Array.from(first.text).length,100);
  assert.equal(first.complete,false);
  assert.equal(first.nextOffset,100);
  const second=docs.readDoc({id:'ui-control',start:first.nextOffset,limit:100});
  assert.equal(first.text+second.text,whole.text.slice(0,200));
  const tail=docs.readDoc({id:'ui-control',start:total-10,limit:100});
  assert.equal(tail.complete,true);
  assert.equal(tail.nextOffset,null);
  assert.throws(()=>docs.readDoc({id:'ui-control',start:total+1}),/INVALID_DOCS_OFFSET/);
  assert.throws(()=>docs.readDoc({id:'not-a-doc'}),/UNKNOWN_DOCS_ID/);
});

test('a corpus/engine mismatch is reported instead of silently cited',()=>{
  assert.deepEqual(docs.checkEngineVersion('4.7.2-stable'),{compatible:true,engineVersion:'4.7.2-stable',corpusEngineVersion:'4.7.2-stable'});
  const mismatch=docs.checkEngineVersion('4.8.0-stable');
  assert.equal(mismatch.compatible,false);
  assert.match(mismatch.warning,/different engine version/);
  assert.equal(docs.checkEngineVersion('').compatible,null);
});
