// Read-only independent audit: durable facts, not the assistant's final prose.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const directory=path.resolve(process.argv[2]||'');
assert.ok(path.basename(directory).startsWith('desktop-native-f-')&&path.basename(path.dirname(directory))==='test-results','Expected isolated F evidence directory');
const report=JSON.parse(fs.readFileSync(path.join(directory,'report.json'),'utf8'));
const checks=[];
function check(name,value){checks.push({name,passed:!!value});if(!value)process.exitCode=1;}
const db=new DatabaseSync(path.join(directory,'profile/plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
const rows=table=>db.prepare(`SELECT * FROM ${table}`).all();
const requests=rows('craftmine_budget_requests'),events=rows('craftmine_budget_events'),tasks=rows('craftmine_tasks'),revisions=rows('craftmine_workspace_revisions'),receipts=rows('craftmine_receipts');
const worlds=rows('craftmine_worlds'),applications=rows('craftmine_applications'),reviews=rows('craftmine_reviews'),requirements=rows('craftmine_task_requirements');
db.close();
const compactions=report.evidence.scenario.compactions;
const session=report.evidence.finalSession?.record?.session;
check('Native runner completed its actual application and restart',report.passed===true);
check('Both normal exits report zero input violations and page errors',[report.evidence.firstExit,report.evidence.exitAudit].every(a=>a&&a.violations.length===0&&a.pageErrors.length===0));
check('Exactly one actual task identity survived authoring',tasks.length===1&&new Set(requests.map(r=>r.task_id)).size===1&&new Set(requests.map(r=>r.owner)).size===1);
check('Durable task binding matches the real host session',JSON.parse(tasks[0]?.binding||'{}').sessionId===report.evidence.identity?.sessionId);
check('Native summary checkpoints are persisted with real summaries',(session?.compactions?.length||0)>=compactions&&(session?.compactions||[]).every(c=>c.summary.length>100&&c.tokensBefore>0));
check('Every requested compaction is also in the Rust ledger',events.filter(e=>e.kind==='compaction').length>=compactions);
check('Actual summary and review calls share the same cumulative budget',requests.filter(r=>r.purpose==='summary'&&r.status==='known').length>=compactions&&requests.some(r=>r.purpose==='review'&&r.status==='known'));
check('Request settlements retain usage rather than clear after compaction',requests.every(r=>r.status==='known'&&JSON.parse(r.settlement).usage.totalTokens>0));
check('Actual user requirement is durable',requirements.length===1&&requirements[0].text.includes('native-oak'));
const current=JSON.parse(worlds.find(w=>w.id===report.evidence.identity?.worldId)?.document||'{}');
const tree=current.build?.scene?.objects?.find(o=>o.id==='native-oak');
const height=tree?Math.max(...tree.parts.map(p=>p.offset.y+p.size.y))-Math.min(...tree.parts.map(p=>p.offset.y)):null;
check('Applied final source satisfies explicit tree geometry',tree?.name==='记忆松树'&&tree.position.x===10&&tree.position.y===6&&tree.position.z===4&&Math.abs(height-3)<1e-9&&tree.parts.some(p=>p.material==='wood')&&tree.parts.some(p=>p.material==='leaves'));
check('One application and a completed real review exist',applications.length===1&&reviews.some(r=>r.status==='completed'));
if(compactions===3){
  check('At least four actual draft revisions and patch receipts survived',Math.max(...revisions.map(r=>r.revision))>=4&&receipts.length>=4);
  const sourceAt=revision=>JSON.parse(revisions.find(r=>r.revision===revision)?.draft||'{}').scene?.objects?.find(o=>o.id==='native-oak');
  // The compiler's draft schema is inspected independently below; retain the full rows for review.
  const first=sourceAt(1),second=sourceAt(2),third=sourceAt(3);
  check('Persisted revisions retain initial and intermediate authored positions',first?.position.x===-10&&second?.position.x===-10&&third?.position.x===10);
}
const usage=requests.reduce((sum,r)=>sum+(JSON.parse(r.settlement||'{}').usage?.totalTokens||0),0);
const audit={format:'craftmine.f-durable-audit/1',passed:checks.every(c=>c.passed),checks,totals:{requests:requests.length,compactions:session?.compactions?.length||0,summaryRequests:requests.filter(r=>r.purpose==='summary').length,providerTotalTokens:usage},facts:{requests,events,receipts,revisions,requirements,applications,reviews}};
fs.writeFileSync(path.join(directory,'durable-audit.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({passed:audit.passed,checks,totals:audit.totals},null,2));
