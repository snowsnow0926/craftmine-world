const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {randomUUID} = require('node:crypto');

class CoreClient {
  constructor(binary, directory) { this.binary=binary;this.rootDirectory=directory;this.directory=directory;this.pending=new Map();this.child=null;this.starting=null;this.transition=false; }
  async start() {
    if(this.transition)throw Object.assign(Error('BACKUP_SWITCH_IN_PROGRESS'),{code:'BACKUP_SWITCH_IN_PROGRESS'});
    if(this.starting)return this.starting;
    const starting=(async()=>{this.directory=await require('./portable-restore-service.cjs').resolveActiveDirectory(this.rootDirectory);return this.launch();})();this.starting=starting;
    try{return await starting;}catch(error){if(this.starting===starting)this.starting=null;await this.stopProcess();throw error;}
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
    const hello=await this.rawCall('hello');
    if(this.directory!==this.rootDirectory) {
      await require('./portable-restore-service.cjs').verifyActiveCore(this.rootDirectory,this.directory,(m,p)=>this.rawCall(m,p));
    }
    return hello;
  }
  call(method, params={}, timeoutMs=5000) {
    if(this.transition)return Promise.reject(Object.assign(Error('BACKUP_SWITCH_IN_PROGRESS'),{code:'BACKUP_SWITCH_IN_PROGRESS'}));
    return this.rawCall(method,params,timeoutMs);
  }
  rawCall(method, params={}, timeoutMs=5000) {
    const child=this.child;if(!child||child.exitCode!==null||child.stdin.destroyed)return Promise.reject(Error('Craftmine Rust service is unavailable'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Craftmine Rust request timed out'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer,child});
      child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  async stop() {
    if(this.transition)throw Object.assign(Error('BACKUP_SWITCH_IN_PROGRESS'),{code:'BACKUP_SWITCH_IN_PROGRESS'});
    return this.stopProcess();
  }
  async stopProcess() {
    const child=this.child;if(!child)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();},2500);
      const deadline=setTimeout(()=>reject(Error('BACKUP_CORE_STOP_TIMEOUT')),10000);
      child.once('exit',()=>{clearTimeout(timer);clearTimeout(deadline);resolve();});
      child.stdin.end();
    });
  }
  async exclusive(run) {
    if(this.transition||this.pending.size)throw Object.assign(Error('BACKUP_CORE_BUSY'),{code:'BACKUP_CORE_BUSY'});
    await this.start();
    if(this.transition||this.pending.size)throw Object.assign(Error('BACKUP_CORE_BUSY'),{code:'BACKUP_CORE_BUSY'});
    this.transition=true;
    try {
      // The ordered RPC barrier also drains an earlier timed-out request.
      await this.rawCall('hello',{},60000);
      return await run({call:(m,p,t=120000)=>this.rawCall(m,p,t),
        directory:()=>this.directory,
        switchDirectory:async directory=>{await this.stopProcess();this.directory=directory;this.starting=null;const hello=await this.launch();this.starting=Promise.resolve(hello);return hello;}});
    } finally {this.transition=false;}
  }
}
module.exports={CoreClient};
