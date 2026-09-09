// Durable evidence fixture only; no model, renderer or reviewer is run.
export function sourceFixture({context,empty,source,build,INITIAL_SNAPSHOT}){
async function applied(call,scene=source,extensions=[]){
  await call('world.create',{id:'source-world',title:'Source world',world:{build:build(empty),snapshot:INITIAL_SNAPSHOT,extensions}});
  const workspace=await call('workspace.open',{context,selectedWorld:'source-world'});
  await call('workspace.commit',{context,binding:workspace.task.binding,toolCallId:'fixture-edit',revision:0,request:{fixture:'compiled source'},draft:{scene}});
  const verification=await call('verification.submit',{context,toolCallId:'fixture-check',revision:1,summary:'Fixture compiled source',origin:{modelKey:'fixture/provider',request:{messageId:'fixture-user',text:'Add a tree'}}});
  const check=await call('verification.claim',{id:verification.id,token:'fixture-worker'});const compiled=build(scene,extensions);
  await call('verification.finish',{id:check.id,token:'fixture-worker',output:{inputHash:check.inputHash,artifact:{build:compiled,extensions},evidence:{format:'craftmine.desktop-check/1',passed:true,compiler:{passed:true},behaviors:{build:compiled.hash,passed:true,modules:compiled.behaviors.map(b=>({id:b.definition.id,revision:b.id,passed:true}))},render:{passed:true,version:compiled.id}}}});
  const review=await call('review.start',{verificationId:check.id,id:'fixture-review',token:'fixture-reviewer'});
  const plan=await call('review.plan',{id:review.id,token:'fixture-reviewer',plan:{modelKey:'fixture/provider',text:'Fixture review',assertions:[{id:'tree-exists',why:'The tree exists'}]}});
  await call('review.finish',{id:review.id,token:'fixture-reviewer',output:{format:'craftmine.desktop-review/1',inputHash:review.inputHash,planHash:plan.hash,modelKey:'fixture/provider',advisory:true,verdict:'ready',text:'Fixture review',acceptance:{passed:true,assertions:[{id:'tree-exists',passed:true}],verificationOutputHash:review.input.verificationOutputHash}}});
  const application=await call('application.prepare',{id:'fixture-application',token:'fixture-owner',verificationId:check.id,reviewId:review.id,worldId:'source-world',revision:0,snapshot:INITIAL_SNAPSHOT});
  await call('application.commit',{id:application.id,token:'fixture-owner',evidence:{format:'craftmine.desktop-application/1',inputHash:application.inputHash,render:{passed:true,version:compiled.id,capture:{sha256:'a'.repeat(64)}},player:INITIAL_SNAPSHOT.player}});
  return application;
}
return applied;}
