import {describe,it,expect} from 'vitest';
import {nativeCompaction} from './codex-native-compaction.js';
import {historyHydration,HISTORY_HYDRATION_TEXT_BYTES} from './codex-history-restore.js';

describe('native history maintenance, no model',()=>{
  it('requires matching native compaction item and terminal completion; foreign turns do not settle it',async()=>{
    const pending=nativeCompaction(new AbortController().signal);let finished=false;void pending.done.then(()=>{finished=true;});
    pending.receive('turn/started',{turn:{id:'compact'}});
    pending.receive('item/completed',{turnId:'foreign',item:{type:'contextCompaction'}});
    pending.receive('turn/completed',{turn:{id:'foreign',status:'completed'}});
    await Promise.resolve();expect(finished).toBe(false);
    pending.receive('item/completed',{turnId:'compact',item:{type:'contextCompaction'}});
    pending.receive('turn/completed',{turn:{id:'compact',status:'completed'}});
    await pending.done;expect(finished).toBe(true);
  });
  it('empty completion, failed compaction and cancellation cannot authorize the player turn',async()=>{
    for(const status of ['completed','failed','interrupted']){
      const pending=nativeCompaction(new AbortController().signal);
      pending.receive('turn/started',{turn:{id:'compact'}});
      pending.receive('turn/completed',{turn:{id:'compact',status}});
      await expect(pending.done).rejects.toThrow(status==='interrupted'?'TURN_ABORTED':'CODEX_HISTORY_COMPACT_FAILED');
    }
    const controller=new AbortController(),pending=nativeCompaction(controller.signal);controller.abort();
    await expect(pending.done).rejects.toThrow('TURN_ABORTED');
    pending.receive('turn/started',{turn:{id:'late'}});
    pending.receive('item/completed',{turnId:'late',item:{type:'contextCompaction'}});
    pending.receive('turn/completed',{turn:{id:'late',status:'completed'}});
    await expect(pending.done).rejects.toThrow('TURN_ABORTED');
  });
  it('bounds each hydration segment but retains all original records and final original-request/image anchors',()=>{
    const user={source:{messageId:'user'},payload:{role:'user',content:'保留完整城市、全部任务、飞机和小狗。'},images:[]};
    const original={source:{messageId:'tool'},payload:{role:'tool',content:'原始源码🐶'.repeat(200_000)},images:[{type:'image' as const,url:'data:image/png;base64,actual-fixture-block'}]};
    const steps=[...historyHydration([user,original])];let bytes=0,compactions=0;const payloads=new Map<string,string>();
    for(const step of steps){if(step.kind==='compact'){expect(bytes).toBeLessThanOrEqual(HISTORY_HYDRATION_TEXT_BYTES);bytes=0;compactions++;continue;}
      for(const item of step.items as any[]){for(const content of item.content){if(content.type==='input_image')continue;bytes+=Buffer.byteLength(content.text,'utf8');
        if(!content.text.startsWith('Historical Rust'))continue;const [,header,...body]=content.text.split('\n'),meta=JSON.parse(header);
        if(!meta.source.restorationAnchor)payloads.set(meta.source.messageId,(payloads.get(meta.source.messageId)??'')+body.join('\n'));
      }}
    }
    expect(compactions).toBeGreaterThan(1);expect(payloads.get('tool')).toBe(JSON.stringify(original.payload));expect(payloads.get('user')).toBe(JSON.stringify(user.payload));
    const final=steps.slice(steps.map(s=>s.kind).lastIndexOf('compact')+1);
    expect(JSON.stringify(final)).toContain(user.payload.content);expect(JSON.stringify(final)).toContain('input_image');
    for(const step of steps)if(step.kind==='inject')for(const item of step.items as any[])for(const c of item.content)if(c.type==='input_text')expect(c.text).not.toContain('base64,');
  });
});
