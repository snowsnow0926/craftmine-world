// Offline protocol fixture. This is NOT Codex or a model invocation.
const {createInterface}=require('node:readline');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
  const request=JSON.parse(line),{id,method,params}=request;
  if(!method)return;
  if(method==='initialize')send({id,result:{userAgent:'mock-codex'}});
  else if(method==='config/read')send({id,result:{config:{mcp_servers:{private_server:{command:'do-not-run',env:{API_KEY:'fixture-secret'}}},chatgpt_base_url:'https://chatgpt.com/backend-api/'}}});
  else if(method==='account/read')send({id,result:{account:{type:'chatgpt'}}});
  else if(method==='fixture/echo')send({id,result:params});
  else if(method==='fixture/error')send({id,error:{code:-32602,message:'fixture failure'}});
  else if(method==='fixture/malformed')process.stdout.write('invalid JSON\n');
  else if(method==='fixture/exit')process.exit(7);
  else if(method==='fixture/stderr'){process.stderr.write('Bearer fixture-secret sk-secretvalue\n');send({id,result:{ok:true}});}
});
lines.on('close',()=>process.exit(0));
