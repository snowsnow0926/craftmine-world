import http from 'node:http';

// Deterministic provider transport for native acceptance. Never a real-model claim.
export async function startDesktopReviewProvider() {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw Error('fixture input too large');}
      const input=JSON.parse(body),user=input.messages.findLast(message=>message.role==='user');
      const source=JSON.parse(typeof user.content==='string'?user.content:user.content.map(part=>part.text||'').join(''));
      if(!source.request?.messageId||!source.request?.text?.includes('真实宿主需求'))throw Error('Missing host request provenance');
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
