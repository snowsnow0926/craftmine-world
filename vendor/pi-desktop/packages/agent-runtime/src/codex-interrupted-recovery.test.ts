import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyInterruptedTail} from './codex-interrupted-recovery.js';

export function recoveryFixture(){
  const recovery={hostTurnId:'host-turn',sessionId:'s',projectId:'p',worldId:'w',userMessageId:'u',tailEndMessageId:'a',deferredMessageIds:[]};
  const toolId='codex-'+createHash('sha256').update(JSON.stringify(['host-turn','call1'])).digest('hex');
  const metadata={thread:{id:'thread-1',status:{type:'notLoaded'},cwd:'C:/scratch/codex-empty',modelProvider:'openai',model:'gpt-6-astra',reasoningEffort:'xhigh'}};
  const history:any[]=[{id:'u',role:'user',status:'complete',content:'保留城市和图片'},
    {id:'text',role:'assistant',status:'complete',content:'I will inspect it.'},
    {id:'tool',role:'tool',status:'complete',toolStatus:'success',toolCallId:toolId,toolName:'plugin_craftmine_world_godot_project_facts',toolArgs:{b:2,a:1},toolResult:{revision:14,source:'line\nline'}},
    {id:'a',role:'assistant',status:'aborted',content:'',error:{code:'TURN_ABORTED'}}];
  const page={data:[{id:'native-turn',status:'interrupted',itemsView:'full',error:null,items:[
    {type:'userMessage',content:[{type:'text',text:'Current authoritative host facts: '+JSON.stringify({world:{id:'w'},binding:{sessionId:'s',projectId:'p',turnId:'host-turn'}})},{type:'text',text:history[0].content,text_elements:[]}]},
    {type:'reasoning',content:['native reasoning']},
    {type:'agentMessage',text:'I will inspect it.'},
    {type:'dynamicToolCall',id:'call1',namespace:'craftmine',tool:'godot_project_facts',arguments:{a:1,b:2},status:'completed',success:true,contentItems:[{type:'inputText',text:'{"source":"line\\nline","revision":14}'}]},
  ]}]};
  return {metadata,page,recovery,history};
}
const verify=(f:ReturnType<typeof recoveryFixture>)=>verifyInterruptedTail(f.metadata,f.page,f.recovery,f.history,'thread-1','C:/scratch/codex-empty');
describe('public native interrupted tail verification',()=>{
  it('matches complete original wording, visible timeline and canonical JSON regardless of key order',()=>{
    const f=recoveryFixture();expect(verify(f)).toMatch(/^[a-f0-9]{64}$/);
    f.page.data[0].id='another-terminal';expect(verify(f)).not.toBe(verify(recoveryFixture()));
  });
  it('rejects changed identity, missing/extra/pending tools, wrong results and changed user or assistant text',()=>{
    const mutations:Array<(f:any)=>void>=[f=>f.metadata.thread.status.type='active',f=>f.metadata.thread.id='foreign',
      f=>f.metadata.thread.cwd='C:/other',f=>f.page.data[0].status='inProgress',f=>f.page.data[0].itemsView='summary',
      f=>f.recovery.hostTurnId=null,f=>f.recovery.worldId='foreign',f=>f.history[0].content+=' changed',
      f=>f.history[1].content+=' changed',f=>f.history[2].toolResult.revision++,f=>f.history[2].toolArgs.a++,
      f=>f.page.data[0].items.pop(),f=>f.page.data[0].items.push(f.page.data[0].items.at(-1)),
      f=>f.page.data[0].items.at(-1).status='inProgress',f=>f.page.data[0].items.at(-1).id='unseen',
      f=>f.history.at(-1).content='unconfirmed visible text'];
    for(const mutate of mutations){const f=recoveryFixture();mutate(f);expect(()=>verify(f)).toThrow('CODEX_INTERRUPTED_RECOVERY_UNVERIFIED');}
  });
  it('requires exact original image bytes and rejects unreadable attachments rather than dropping them',()=>{
    const f=recoveryFixture();f.history[0].attachments=[{kind:'image',mimeType:'image/png',data:'cG5n'}];
    (f.page.data[0].items[0] as any).content.push({type:'image',url:'data:image/png;base64,cG5n'});expect(verify(f)).toMatch(/^[a-f0-9]{64}$/);
    f.history[0].attachments[0].data='';expect(()=>verify(f)).toThrow('CODEX_INTERRUPTED_RECOVERY_UNVERIFIED');
  });
});
