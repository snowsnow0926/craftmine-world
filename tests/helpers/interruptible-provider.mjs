import http from 'node:http';
export const PARTIAL_TEXT='Protocol interruption fixture: this partial response must survive save and exit. ';
export async function startInterruptibleProvider(){
 const requests=[],streams=new Set();let finish=false;
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!req.url.endsWith('/chat/completions')){res.writeHead(404);res.end();return;}
   let body='';for await(const bytes of req){body+=bytes;if(body.length>4*1024*1024)throw Error('FIXTURE_BODY_TOO_LARGE');}
   const input=JSON.parse(body);if(input.model!=='protocol-interruption-fixture'||!input.stream)throw Error('UNEXPECTED_PROVIDER_REQUEST');
   const record={number:requests.length+1,model:input.model,stream:true,closed:false,finished:false};requests.push(record);
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   const chunk=(delta,reason=null)=>res.write('data: '+JSON.stringify({id:'protocol-'+record.number,object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:reason}],...(reason?{usage:{prompt_tokens:32,completion_tokens:16,total_tokens:48}}:{})})+'\n\n');
   chunk({role:'assistant',content:PARTIAL_TEXT});
   let timer;
   const end=()=>{if(res.destroyed||record.finished)return;record.finished=true;clearInterval(timer);chunk({content:'Continuation finished normally.'});chunk({},'stop');res.end('data: [DONE]\n\n');};
   const active={end};streams.add(active);res.on('close',()=>{record.closed=true;clearInterval(timer);streams.delete(active);});
   if(finish)end();else timer=setInterval(()=>{if(!res.destroyed)chunk({content:'.'});},250);
  }catch(error){if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error)}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/v1`,requests,finishFuture(){finish=true;},close:async()=>{for(const stream of streams)stream.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
