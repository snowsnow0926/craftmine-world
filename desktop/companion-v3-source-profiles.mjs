import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {componentBridgeProfiles,RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256} from './released-component-bridge.mjs';

export function companionV3SourceProfiles(repository){
  const pin=([name,source])=>({path:name,sha256:source==='shared/runtime_bridge_engine_v1.gd'?RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256:createHash('sha256').update(fs.readFileSync(path.join(repository,'desktop/godot',source))).digest('hex')});
  const controller=[['craftmine_shared/base_adapter.gd','shared/adapters/creation-sandbox-controller-v2.gd'],
    ['craftmine_shared/base_adapter_controller_v1.gd','shared/adapters/creation-sandbox-controller-v1.gd'],
    ['craftmine_shared/base_adapter_legacy.gd','shared/adapters/creation-sandbox.gd'],
    ['craftmine_shared/progress_collision.gd','shared/progress_collision.gd']];
  return componentBridgeProfiles([
    {id:'legacy-component-runtime',requirements:[['craftmine_shared/base_adapter.gd','shared/adapters/creation-sandbox.gd'],['craftmine_shared/runtime_bridge.gd','shared/runtime_bridge.gd']].map(pin)},
    {id:'creation-player-collision/1',requirements:[...controller,['craftmine_shared/runtime_bridge.gd','shared/runtime_bridge.gd']].map(pin)},
    {id:'creation-player-collision/1+engine-monitor/1',requirements:[...controller,
      ['craftmine_shared/runtime_bridge.gd','shared/runtime_bridge_engine_v1.gd'],
      ['craftmine_shared/runtime_bridge_base.gd','shared/runtime_bridge.gd'],
      ['craftmine_shared/engine_performance.gd','shared/engine_performance.gd']].map(pin)},
  ],2);
}
