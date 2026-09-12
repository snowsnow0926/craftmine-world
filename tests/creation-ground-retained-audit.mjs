// Read-only audit of isolated before/after desktop profiles. No live player DB.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..'),worldId='world-e2b39ed23ff7';
const before=path.resolve(process.argv[2]),after=path.resolve(process.argv[3]);
for(const target of [before,after])assert.ok(target.startsWith(path.join(root,'test-results')+path.sep));
const read=directory=>{const db=new DatabaseSync(path.join(directory,'tasks.sqlite'),{readOnly:true});try{return db.prepare('select id,title,revision,document from craftmine_worlds order by id').all().map(row=>({...row,document:JSON.parse(row.document)}));}finally{db.close();}};
const first=read(before),last=read(after),a=first.find(w=>w.id===worldId),b=last.find(w=>w.id===worldId);
assert.deepEqual(b.document.snapshot,a.document.snapshot,'exact saved gameplay snapshot preserved');
assert.deepEqual(b.document.extensions,a.document.extensions,'extensions preserved');
assert.notEqual(b.document.build.id,a.document.build.id,'formal build changed');
assert.equal(b.title,a.title);
const repos=fs.readdirSync(path.join(before,'content-history/repos'));
const git=(dir,...args)=>execFileSync('git',['--no-optional-locks','--git-dir',dir,...args],{encoding:'utf8',windowsHide:true}).trim();
const refs=[];
for(const repo of repos){
 const old=path.join(before,'content-history/repos',repo,'repo.git'),current=path.join(after,'content-history/repos',repo,'repo.git');
 const oldMain=git(old,'rev-parse','refs/heads/main'),newMain=git(current,'rev-parse','refs/heads/main');
 assert.equal(newMain,oldMain,'unapplied main draft and its complete tree retained');
 const history=git(old,'rev-list','--all').split(/\r?\n/);for(const oid of history)git(current,'cat-file','-e',oid+'^{commit}');
 refs.push({repo,mainHead:oldMain,oldCommitsStillPresent:history.length});
}
const report={worldId,before,after,oldBuild:a.document.build.id,newBuild:b.document.build.id,snapshotEqual:true,extensionsEqual:true,refs};
const output=path.join(path.dirname(path.dirname(path.dirname(after))),'ground-retained-audit.json');
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output}));
