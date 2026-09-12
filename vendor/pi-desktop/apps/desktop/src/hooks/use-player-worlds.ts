import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {craftmineWorldBridge} from "../lib/craftmine-worlds";
import {parsePlayerWorlds, type PlayerWorldKind, type PlayerWorlds} from "../lib/player-worlds";

export function usePlayerWorlds() {
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [worlds, setWorlds] = useState<PlayerWorlds | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PlayerWorldKind | null>(null);
  const busy = useRef(false);
  const operation = useRef(0);
  const [canCancel,setCanCancel]=useState(false);
  const [cancelling,setCancelling]=useState(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    try {
      if (!bridge) throw Error("PLAYER_WORLDS_UNAVAILABLE");
      const current = parsePlayerWorlds(await bridge.call("world.playerWorlds"));
      if (alive.current && epoch.current === generation) {setWorlds(current);setError("");}
    } catch (failure) {
      if (alive.current && epoch.current === generation) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [bridge]);
  useEffect(() => {
    alive.current = true;void refresh();
    const changed = () => {void refresh();};
    const off = bridge?.onChanged(changed);
    window.addEventListener("craftmine-world-changed", changed);
    return () => {alive.current=false;epoch.current++;off?.();window.removeEventListener("craftmine-world-changed",changed);};
  }, [bridge,refresh]);
  const enter = useCallback(async (kind:PlayerWorldKind):Promise<string | null> => {
    if (!bridge || busy.current) return null;
    const ticket=++operation.current;
    const current=()=>alive.current&&operation.current===ticket;
    busy.current=true;setPending(kind);setError("");
    try {
      let receipt = await bridge.call("world.playerEnter", {kind}) as {kind?:string;worldId?:string;state?:string;error?:string};
      if (receipt.kind !== kind || !receipt.worldId) throw Error("PLAYER_WORLD_ENTRY_NOT_READY");
      const expectedWorldId=receipt.worldId;
      if(current())setCanCancel(receipt.state==="initializing");
      let actual = parsePlayerWorlds(await bridge.call("world.playerWorlds"));
      let slot=actual.slots.find(slot=>slot.kind===kind);
      if (alive.current) setWorlds(actual);
      while(receipt.state==="initializing"&&current()){
        if (slot?.worldId!==expectedWorldId) throw Error("PLAYER_WORLD_SELECTION_CHANGED");
        if (slot.state==="failed") throw Error(slot.error||"PLAYER_WORLD_INITIALIZATION_FAILED");
        if (slot.state==="ready") {
          setCanCancel(false);
          receipt=await bridge.call("world.playerEnter",{kind}) as typeof receipt;
          if(receipt.kind!==kind||receipt.worldId!==expectedWorldId)throw Error("PLAYER_WORLD_SELECTION_CHANGED");
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,1500));
        if(!current())return null;
        actual=parsePlayerWorlds(await bridge.call("world.playerWorlds"));
        if(!current())return null;
        slot=actual.slots.find(slot=>slot.kind===kind);
        setWorlds(actual);
      }
      if(!current())return null;
      if(receipt.state!=="ready")throw Error(receipt.error||"PLAYER_WORLD_ENTRY_NOT_READY");
      actual = parsePlayerWorlds(await bridge.call("world.playerWorlds"));slot=actual.slots.find(slot=>slot.kind===kind);
      if (actual.activeKind!==kind || actual.activeWorldId!==receipt.worldId || slot?.worldId!==receipt.worldId || slot.state!=="ready") throw Error("PLAYER_WORLD_SELECTION_CHANGED");
      if (!current()) return null;
      setWorlds(actual);window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
      return receipt.worldId;
    } catch (failure) {
      if(current())setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    } finally {if(operation.current===ticket){busy.current=false;if(alive.current){setPending(null);setCanCancel(false);}}}
  }, [bridge]);
  const cancel=async()=>{
    if(!bridge||!pending||!canCancel||cancelling)return;
    setCancelling(true);setError("");
    // Invalidate only the waiting presentation, then await the host-owned
    // initializer cancellation and restoration before re-enabling the cards.
    operation.current++;
    try {await bridge.call("world.playerCancel",{kind:pending});await refresh();setPending(null);setCanCancel(false);busy.current=false;}
    catch(failure){
      const message=failure instanceof Error?failure.message:String(failure);
      try {
        // A lost reply or an outside selection change may leave no operation
        // to cancel. Only a fresh host read can establish that the target is
        // no longer initializing; do not convert an unreadable outcome into
        // successful cancellation or pretend the original world was restored.
        const actual=parsePlayerWorlds(await bridge.call("world.playerWorlds"));
        const target=actual.slots.find(slot=>slot.kind===pending);
        if(alive.current){
          setWorlds(actual);
          if(target&&(target.state!=="initializing"||actual.activeWorldId!==target.worldId)){
            busy.current=false;setPending(null);setCanCancel(false);
          }
        }
      } catch { /* Unknown state keeps the explicit cancellation retry. */ }
      if(alive.current)setError(message);
    }
    finally{setCancelling(false);}
  };
  return {worlds,error,pending,canCancel,cancelling,cancel,refresh,enter};
}
