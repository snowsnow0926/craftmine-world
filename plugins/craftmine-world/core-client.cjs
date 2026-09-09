const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {randomUUID} = require('node:crypto');

class CoreClient {
  constructor(binary, directory) { this.binary=binary;this.directory=directory;this.pending=new Map();this.child=null;this.starting=null; }
  async start() {
    if(this.starting)return this.starting;
    const starting=this.launch();this.starting=starting;
    try{return await starting;}catch(error){if(this.starting===starting)this.starting=null;throw error;}
  }
  async launch() {
    if(!this.binary)throw Error('Craftmine Rust runtime is not configured');
    const child=spawn(this.binary,['--data-dir',this.directory],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;
    const fail=error=>{
      for(const [id,job] of this.pending){if(job.child===child){clearTimeout(job.timer);job.reject(error);this.pending.delete(id);}}
      if(this.child===child){this.child=null;this.starting=null;}
    };
    child.on('error',fail);
    child.stdin.on('error',error=>{fail(error);child.kill();});
    child.on('exit',(code)=>fail(Error('Craftmine Rust service exited: '+code)));
    child.stderr.on('data',()=>{});
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      let response;try{response=JSON.parse(line);}catch{fail(Error('Invalid Rust service response'));child.kill();return;}
      const job=this.pending.get(response.id);if(!job)return;
      this.pending.delete(response.id);clearTimeout(job.timer);
      if(response.error)job.reject(Object.assign(Error(response.error.message),{code:response.error.code,errorCode:response.error.code,retryable:response.error.retryable===true}));else job.resolve(response.result);
    });
    return this.call('hello');
  }
  call(method, params={}, timeoutMs=5000) {
    const child=this.child;if(!child||child.exitCode!==null||child.stdin.destroyed)return Promise.reject(Error('Craftmine Rust service is unavailable'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Craftmine Rust request timed out'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer,child});
      child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  async stop() {
    const child=this.child;if(!child)return;
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{child.kill();},2500);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
      child.stdin.end();
    });
  }
}
module.exports={CoreClient};
