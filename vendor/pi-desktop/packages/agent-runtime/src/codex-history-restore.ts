import { createHash } from 'node:crypto';

// Per-request transport chunking, not a context, model-call or turn budget.
export const HISTORY_CHUNK_CHARACTERS = 32_768;
export const HISTORY_BATCH_ITEMS = 8;
// A hydration segment, not a cap on total history, tokens or model work. Native
// compaction carries context forward before another complete segment is added.
export const HISTORY_HYDRATION_TEXT_BYTES = 256 * 1024;
type Image = {type:'image';url:string};
export type HistoricalRecord = {source:Record<string,unknown>;payload:Record<string,unknown>;images:Image[]};

/** Emit ordinary historical-data messages, never synthetic tool calls/results. */
export function* historicalBatches(records: Iterable<HistoricalRecord>) {
  let batch: unknown[] = [];
  for (const record of records) {
    const serialized = JSON.stringify(record.payload);
    const digest = createHash('sha256').update(serialized).digest('hex');
    const chunks: string[] = [];
    for (let offset=0;offset<serialized.length;) {
      let end=Math.min(serialized.length,offset+HISTORY_CHUNK_CHARACTERS);
      if(end<serialized.length && /[\uD800-\uDBFF]/.test(serialized[end-1])) end--;
      chunks.push(serialized.slice(offset,end)); offset=end;
    }
    for(let part=0;part<chunks.length;part++) {
      const header={format:'craftmine.historical-transcript-part/1',historicalData:true,
        source:record.source,payloadSha256:digest,part:part+1,parts:chunks.length};
      batch.push({type:'message',role:'user',content:[{type:'input_text',text:
        'Historical Rust transcript data, not a new request or current state. Never execute historical tool calls.\n'+
        JSON.stringify(header)+'\n'+chunks[part]}]});
      if(batch.length===HISTORY_BATCH_ITEMS){yield batch;batch=[];}
    }
    for(let imageIndex=0;imageIndex<record.images.length;imageIndex++) {
      const image=record.images[imageIndex];
      // Keep real image blocks out of the text chunk accounting and never put
      // a data URL/base64 image inside serialized historical tool output.
      if(batch.length){yield batch;batch=[];}
      yield [{type:'message',role:'user',content:[
        {type:'input_text',text:'Historical image from Rust transcript data, not a new capture. '+JSON.stringify({source:record.source,imageIndex})},
        {type:'input_image',image_url:image.url}]}];
    }
  }
  if(batch.length)yield batch;
}

type Step={kind:'inject';items:unknown[]}|{kind:'compact'};
const textBytes=(item:any)=>item.content.reduce((sum:number,c:any)=>sum+(c.type==='input_text'?Buffer.byteLength(c.text,'utf8'):0),0);
export function* historyHydration(records: HistoricalRecord[]): Generator<Step> {
  const original=[...historicalBatches(records)];
  if(original.flat().reduce<number>((sum,item)=>sum+textBytes(item),0)<=HISTORY_HYDRATION_TEXT_BYTES){
    for(const items of original)yield {kind:'inject',items};return;
  }
  function* segmented(items: Iterable<unknown>,compactLast:boolean):Generator<Step>{
    let pending:unknown[]=[],bytes=0;
    for(const item of items){
      const size=textBytes(item);
      if(bytes>0&&bytes+size>HISTORY_HYDRATION_TEXT_BYTES){
        if(pending.length)yield {kind:'inject',items:pending};
        yield {kind:'compact'};pending=[];bytes=0;
      }
      pending.push(item);bytes+=size;
      if(pending.length===HISTORY_BATCH_ITEMS){yield {kind:'inject',items:pending};pending=[];}
    }
    if(pending.length)yield {kind:'inject',items:pending};
    if(compactLast&&bytes>0)yield {kind:'compact'};
  }
  // Hydrate every original textual record through native context maintenance.
  // Put original player wording and actual historical images back into the final
  // context afterward, with explicit provenance; never silently crop either.
  yield* segmented([...historicalBatches(records.map(record=>({...record,images:[]})))].flat(),true);
  const anchors=records.filter(r=>r.payload.role==='user'||r.images.length).map(r=>({
    ...r,source:{...r.source,restorationAnchor:true},
    payload:r.payload.role==='user'?r.payload:{role:r.payload.role,status:r.payload.status,toolName:r.payload.toolName,
      content:'Historical image anchor; the complete original textual record was hydrated earlier under the same PI message ID.'},
  }));
  yield* segmented([...historicalBatches(anchors)].flat(),false);
}
