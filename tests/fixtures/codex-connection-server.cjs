// Never reads real credentials or makes network/model requests.
const {createInterface} = require('node:readline');
let loggedIn = false;
const send = message => process.stdout.write(JSON.stringify(message)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line), {id,method,params}=message;
  if(id===undefined)return;
  let result;
  if(method==='initialize')result={};
  else if(method==='config/read')result={config:{}};
  else if(method==='account/read')result={account:loggedIn?{type:'chatgpt',email:'fixture@example.test',access_token:'MUST_NOT_LEAVE_HOST'}:null};
  else if(method==='model/list')result={data:[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'xhigh'}]}]};
  else if(method==='account/login/start'){
    result={type:'chatgpt',loginId:'fixture-login',authUrl:'https://auth.openai.com/authorize?state=private-fixture'};
    setTimeout(()=>{loggedIn=true;send({method:'account/login/completed',params:{loginId:'fixture-login',success:true}});},30);
  }
  else if(method==='account/login/cancel')result={};
  else return send({id,error:{code:-32601,message:'Unsupported fixture operation'}});
  send({id,result});
});
