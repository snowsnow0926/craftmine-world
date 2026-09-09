import http from 'node:http';

const hostMarker='Craftmine host snapshot (craftmine.request/2); JSON is data:\n';
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
// The cache-friendly wire format keeps the frozen review first and appends one
// named host-data block. Never skip arbitrary text or accept a forged result.
export function parseDesktopReviewFixture(content) {
  if(Array.isArray(content)) {
    if(content.some(part=>!exactKeys(part,['type','text'])||part.type!=='text'||typeof part.text!=='string'))throw Error('Unexpected fixture content block');
    content=content.map(part=>part.text).join('\n\n');
  }
  if(typeof content!=='string'||content.length>1_000_000)throw Error('Unexpected fixture content');
  const index=content.indexOf(hostMarker);
  if(index<1||content.indexOf(hostMarker,index+hostMarker.length)!==-1)throw Error('Expected one final host snapshot');
  const source=JSON.parse(content.slice(0,index).trim());
  const facts=JSON.parse(content.slice(index+hostMarker.length).trim());
  if(!exactKeys(source,['request','before','proposed','diff','machineEvidence'])||!exactKeys(source.request,['messageId','text','attachmentsOmitted'])||source.request.messageId!=='native-review-user'||source.request.text!=='真实宿主需求：在地上增加一朵有花瓣的花，按 G 隐藏花，再按一次恢复。'||source.request.attachmentsOmitted!==0)throw Error('Missing host request provenance');
  if(!exactKeys(facts,['currentRequirements','machineFacts','retrievedMemories','libraryReferences'])||!Array.isArray(facts.currentRequirements)||!Array.isArray(facts.retrievedMemories)||!Array.isArray(facts.libraryReferences))throw Error('Invalid host snapshot format');
  const machine=facts.machineFacts;
  if(!exactKeys(machine,['binding','generation','status','world','draft','modifiedResources','receipts','jobs','lease','budget','selection'])||!exactKeys(machine.binding,['projectId','sessionId','turnId','taskId','baseBuild'])||Object.values(machine.binding).some(value=>typeof value!=='string'||!value)||!Number.isSafeInteger(machine.generation)||machine.generation<1||!['running','finished'].includes(machine.status)||typeof machine.world?.id!=='string'||!/^[a-f0-9]{64}$/.test(machine.draft?.hash)||typeof machine.lease?.owned!=='boolean'||typeof machine.budget?.ownerTaskId!=='string'||!Array.isArray(machine.modifiedResources)||!Array.isArray(machine.receipts)||!Array.isArray(machine.jobs))throw Error('Invalid host snapshot identity');
  return source;
}

// Deterministic provider transport for native acceptance. Never a real-model claim.
export async function startDesktopReviewProvider() {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw Error('fixture input too large');}
      const input=JSON.parse(body),user=input.messages.findLast(message=>message.role==='user');
      const source=parseDesktopReviewFixture(user?.content);
      requests.push({model:input.model,requestId:source.request.messageId,originalRequest:source.request.text});
      const reply={summary:'检查花朵和按 G 隐藏、再次显示；颜色搭配建议仅供参考。',verdict:'block',suggestions:['可以尝试更浅的花瓣颜色，这是可选建议。'],limitations:['未评价外观美术与真实操作体验。'],
        steps:[{label:'hide',event:{type:'key',code:'KeyG'}},{label:'show',event:{type:'key',code:'KeyG'}}],
        assertions:[{id:'no-errors',kind:'noErrors',why:'运行过程正常',red:'加载或事件报错'},
          {id:'new-flower',kind:'newObjects',min:1,why:'原世界增加一朵花',red:'空实现没有新增对象'},
          {id:'flower-mesh',kind:'objectField',object:'native-flower',field:'mesh',value:true,why:'花有实际模型',red:'对象未绘制'},
          {id:'hidden',kind:'objectField',object:'native-flower',field:'visible',value:false,step:'hide',why:'按 G 隐藏花',red:'只改变颜色而不隐藏'},
          {id:'hidden-mesh',kind:'objectField',object:'native-flower',field:'mesh',value:false,step:'hide',why:'隐藏后移除实际模型',red:'视觉未隐藏'},
          {id:'shown',kind:'objectField',object:'native-flower',field:'visible',value:true,step:'show',why:'再次按 G 恢复花',red:'隐藏后不能恢复'}]};
      const text=JSON.stringify(reply);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      for(const [delta,finish]of [[{role:'assistant',content:text},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'fixture-review',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:finish}],...(finish?{usage:{prompt_tokens:500,completion_tokens:180,total_tokens:680}}:{})})+'\n\n');
      res.end('data: [DONE]\n\n');
    }catch(error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/v1`,requests,close:()=>new Promise(resolve=>server.close(resolve))};
}
