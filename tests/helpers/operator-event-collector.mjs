// This function is installed in the owned renderer before subscribing. Never
// retain each growing message snapshot: long thinking streams are quadratic.
export function createOperatorEventCollector(){
  const pending=new Map(),queue=[],collectorId=globalThis.crypto.randomUUID();let delivery=null,deliverySequence=0,observed=0,updates=0,drained=0,peakPendingRecords=0,omittedUpdateBodyCharacters=0,maxUpdateBodyCharacters=0,collectedBytes=0;
  const peak=()=>{peakPendingRecords=Math.max(peakPendingRecords,queue.length+pending.size+(delivery?.events.length??0));};
  const key=event=>JSON.stringify([event.sessionId,event.turnId,event.event?.message?.id]);
  const flush=id=>{const entry=pending.get(id);if(entry){queue.push(entry);pending.delete(id);}};
  return {
    format:'craftmine.operator-event-collector/2',
    push(event){
      observed++;
      if(event.event?.type==='message_update'){
        updates++;const id=key(event),message=event.event.message??{},previous=pending.get(id),count=(previous?.event.capture.observedUpdates??0)+1;
        const bodyCharacters=(typeof message.content==='string'?message.content.length:0)+(typeof message.thinking==='string'?message.thinking.length:0);omittedUpdateBodyCharacters+=bodyCharacters;maxUpdateBodyCharacters=Math.max(maxUpdateBodyCharacters,bodyCharacters);
        pending.set(id,{sessionId:event.sessionId,turnId:event.turnId,ts:event.ts,event:{type:'message_update',message:{id:message.id,role:message.role,status:message.status,modelId:message.modelId,providerId:message.providerId,contentCharacters:typeof message.content==='string'?message.content.length:null,thinkingCharacters:typeof message.thinking==='string'?message.thinking.length:null},capture:{representation:'coalesced-update-metadata',observedUpdates:count,firstTs:previous?.event.capture.firstTs??event.ts,lastTs:event.ts,deltaTextCharacters:(previous?.event.capture.deltaTextCharacters??0)+(event.event.deltaText?.length??0),deltaThinkingCharacters:(previous?.event.capture.deltaThinkingCharacters??0)+(event.event.deltaThinking?.length??0),completeText:'session-and-message-end'}}});
        peak();return;
      }
      // A control/terminal boundary follows all earlier observed updates, even
      // when it has no message ID (tool, status, error, ask, permission).
      for(const id of pending.keys())flush(id);
      // Terminal text, errors, usage/model calls, tools, asks and status are
      // retained unchanged. Only high-frequency growing snapshots coalesce.
      queue.push(structuredClone(event));
      peak();
    },
    drain(){if(delivery)return delivery;for(const id of pending.keys())flush(id);const events=queue.splice(0);drained+=events.length;collectedBytes+=new TextEncoder().encode(JSON.stringify(events)).length;delivery={deliveryId:collectorId+':'+(++deliverySequence),events,coverage:{format:'craftmine.operator-event-capture/2',observedEvents:observed,observedUpdates:updates,drainedRecords:drained,pendingRecords:queue.length+pending.size,peakPendingRecords,omittedUpdateBodyCharacters,maxUpdateBodyCharacters,collectedBytes,updateRepresentation:'coalesced-metadata',terminalEvents:'complete',fullTranscript:'session.json and turns'}};return delivery;},
    acknowledge(id){if(delivery?.deliveryId===id){delivery=null;return true;}return false;},
    status(){return {observed,updates,drained,pendingRecords:queue.length+pending.size+(delivery?.events.length??0),peakPendingRecords,omittedUpdateBodyCharacters,maxUpdateBodyCharacters,collectedBytes};},
  };
}

// Retry the observation transport; never abort a healthy model for a lost CDP
// response. After three failed reconnects, require an explicit operator retry.
export async function recoverOperatorObserver({connect,notify,waitForOperator,assertAlive}){
  for(;;){
    for(let attempt=1;attempt<=3;attempt++){
      assertAlive();notify({state:'reconnecting',attempt});
      try{await connect();notify({state:'healthy',attempt});return;}
      catch(error){assertAlive();notify({state:'reconnect-failed',attempt,error:String(error?.message??error)});}
    }
    notify({state:'degraded-awaiting-operator'});await waitForOperator();assertAlive();
  }
}

export function isRecoverableOperatorCaptureError(error){
  return /PAGE_RPC_TIMEOUT|PAGE_CONNECTION_CLOSED|PAGE_CONNECTION_UNAVAILABLE|WebSocket is not open|WebSocket was closed|WebSocket is closed|Cannot find context|Execution context was destroyed/.test(String(error?.message??error));
}
