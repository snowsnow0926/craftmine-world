// Real offline corpus tests. No provider, browser, credentials or engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const docs=createRequire(import.meta.url)('../../../plugins/craftmine-world/godot-docs.cjs');

test('Chinese questions find existing reference topics with explicit alias evidence',()=>{
  const examples=[
    ['如何让准星居中？','ui-control','Crosshair overlay'],
    ['如何保存玩家进度和恢复存档？','state-and-save','Restore must be total'],
    ['俯视游戏的瓦片碰撞','top-down-2d','Tile maps and collision'],
    ['如何做无窗口自动验证？','headless-testing','Probes over assertions'],
    ['网页导出的线程限制','web-export-limits','Threads'],
    ['如何连接信号？','signals-and-events','Connecting'],
    ['攝影機射線瞄準','camera3d-and-rays','Physics raycast'],
  ];
  for(const [query,id,heading]of examples){
    const result=docs.searchDocs({query});const match=result.matches.find(m=>m.id===id);
    assert.ok(match,`${query} must find ${id}`);
    assert.ok(match.matchedAliases.every(alias=>query.includes(alias)));
    const body=docs.readDoc({id:match.id});assert.ok(body.doc.headings.includes(heading));
    assert.equal(result.corpusDigest,body.citation.corpusDigest);
  }
});
test('mixed-language search combines Chinese topics with unchanged API token matching',()=>{
  const result=docs.searchDocs({query:'Camera3D 准星射线',limit:2});
  assert.equal(result.matches[0].id,'camera3d-and-rays');
  assert.deepEqual(result.matches[0].matchedAliases,['准星','射线']);
  assert.ok(result.matches[0].score>docs.searchDocs({query:'Camera3D'}).matches[0].score);
  const filtered=docs.searchDocs({query:'准星',topic:'ui'});
  assert.deepEqual(filtered.matches.map(m=>m.id),['ui-control']);
});
test('unknown Chinese and mixed unknown queries return honest zero results',()=>{
  for(const query of ['量子纠缠传送系统','不存在的中文术语','量子纠缠 zxqvunknown']){
    const result=docs.searchDocs({query});assert.equal(result.matchCount,0,query);
    assert.deepEqual(result.matches,[]);assert.equal(result.truncated,false);
  }
  assert.throws(()=>docs.searchDocs({query:'  '}),/INVALID_DOCS_QUERY/);
  assert.throws(()=>docs.searchDocs({query:'!!!'}),/INVALID_DOCS_QUERY/);
});
test('English ranking and reference bytes retain their pre-change identities',()=>{
  const result=docs.searchDocs({query:'crosshair aim',limit:5});
  assert.deepEqual(result.matches.map(({id,score})=>({id,score})),[
    {id:'camera3d-and-rays',score:10},{id:'ui-control',score:2},{id:'resources',score:1},
  ]);
  assert.equal(result.corpusDigest,'7557b8bdaa6d3221d3757d53814189f179917159a3bee77a82ed4cc8a02f7d4c');
  assert.equal(result.corpusVersion,1);assert.equal(result.searchVersion,2);
  assert.equal(result.searchDigest,docs.docsInfo().searchDigest);assert.match(result.searchDigest,/^[a-f0-9]{64}$/);
  assert.equal(result.untrusted.trust,'untrusted-reference-data');
});
test('Chinese retrieval preserves bounds, deterministic ties and paged-body completeness',()=>{
  const query='准星';const result=docs.searchDocs({query,limit:1});
  assert.equal(result.matches.length,1);assert.equal(result.matchCount,2);assert.equal(result.truncated,true);
  assert.deepEqual(result,docs.searchDocs({query,limit:1}));
  const id=result.matches[0].id,whole=docs.readDoc({id,limit:16000});let next=0,joined='';
  do {const page=docs.readDoc({id,start:next,limit:37});joined+=page.text;next=page.nextOffset;
    assert.equal(page.complete,next===null);assert.equal(page.corpusDigest,whole.corpusDigest);
  } while(next!==null);
  assert.equal(joined,whole.text);
  assert.throws(()=>docs.searchDocs({query:'准'.repeat(201)}),/INVALID_DOCS_QUERY/);
  assert.throws(()=>docs.searchDocs({query,limit:21}),/INVALID_DOCS_LIMIT/);
  assert.throws(()=>docs.searchDocs({query,topic:'missing'}),/UNKNOWN_DOCS_TOPIC/);
});
