// Broker routing tables, kept separate from the broker so the capability
// inventory and the tests can read them without loading the generated domain
// bundle. This module has no host dependency of its own.
'use strict';

// Every Godot tool that reaches a host method directly.
const GODOT_METHODS={godot_project_create:'godotProject.create',godot_project_index:'godotProject.index',
  godot_file_read:'godotProject.read',godot_project_patch:'godotProject.patch',
  godot_asset_put:'godotAsset.put',godot_asset_list:'godotAsset.list',
  godot_build_start:'godotBuild.start',godot_build_read:'godotBuild.read',godot_build_cancel:'godotBuild.cancel',
  godot_candidate_read:'godotCandidate.read',godot_candidate_list:'godotCandidate.list'};

// Tools implemented inside this plugin. `needs` lists the capability flags the
// core handshake must report true for the tool to be usable; `reachable` is only
// used for a tool that does not depend on a flag.
const LOCAL_TOOLS={
  godot_docs:{owner:'L',hostMethod:null,needs:[]},
  godot_project_query:{owner:'L',hostMethod:'godotProject.index+godotProject.read',needs:['godotProjects']},
  godot_runtime_state:{owner:'L',hostMethod:'godotRuntime.describe',needs:['godotProjects']},
  godot_project_facts:{owner:'L',hostMethod:'godotProject.index+godotCandidate.list+godotRuntime.describe',needs:['godotProjects']},
  godot_capability_report:{owner:'L',hostMethod:'hello',needs:[]},
  godot_history:{owner:'L',hostMethod:'content.*',reachable:false,blockedBy:'DEPENDENCY_NOT_WIRED'},
  godot_jobs:{owner:'L',hostMethod:'godotExecutor.status+godotJob.usage+godotJob.continue',needs:[]},
  godot_draft_recovery:{owner:'L',hostMethod:'task.recoverable+task.resume',needs:['sessionDrafts']},
  asset_library:{owner:'L',hostMethod:'asset.search+asset.read+asset.versions',reachable:false,blockedBy:'DEPENDENCY_NOT_WIRED'},
  package_library:{owner:'L',hostMethod:'package.check+package.read+package.list',reachable:false,blockedBy:'DEPENDENCY_NOT_WIRED'},
  // Pre-existing world tools. They are advertised by the same catalogue, so the
  // inventory must report them truthfully instead of as unwired.
  project_inspect:{owner:'C',hostMethod:'workspace.open+inspect',needs:['sessionDrafts']},
  capabilities_read:{owner:'C',hostMethod:'world.read+capabilities',needs:['sessionDrafts']},
  resource_read:{owner:'C',hostMethod:'workspace.recordRead',needs:['sessionDrafts']},
  workspace_patch:{owner:'C',hostMethod:'workspace.commit',needs:['sessionDrafts']},
  requirements_read:{owner:'C',hostMethod:'task.readRequirements',needs:['sessionDrafts']},
  verification_submit:{owner:'C',hostMethod:'verification.submit',needs:['verificationJobs']},
  verification_read:{owner:'C',hostMethod:'verification.read',needs:['verificationJobs']},
  verification_cancel:{owner:'C',hostMethod:'verification.cancel',needs:['verificationJobs']},
  library_search:{owner:'H',hostMethod:'library.search',needs:['publishesWorlds']},
  library_read:{owner:'H',hostMethod:'library.read',needs:['publishesWorlds']},
  library_install:{owner:'H',hostMethod:'library.capture',needs:['publishesWorlds']},
  memory_search:{owner:'J',hostMethod:'memory.search',needs:['advisoryReviews']},
  memory_propose:{owner:'J',hostMethod:'memory.propose',needs:['advisoryReviews']}};

// Only these calls change durable state; a discussion turn must not run them.
// Cancelling a job also mutates durable state and is included.
const WRITE_TOOLS=new Set(['godot_project_create','godot_project_patch','godot_asset_put','godot_build_start',
  'godot_build_cancel','workspace_patch','library_install','verification_submit','verification_cancel',
  'memory_propose']);
// `godot_draft_recovery` mode=resume reopens a durable task: it is a write, not a
// read, so a discussion turn must not run it.
const CONDITIONAL_WRITE_TOOLS={godot_draft_recovery:'resume'};

const GODOT_RECEIPTS={'godotProject.create':'godotProject.receipt','godotProject.patch':'godotProject.receipt',
  'godotAsset.put':'godotBuild.receipt','godotBuild.start':'godotBuild.receipt'};

module.exports={GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS,CONDITIONAL_WRITE_TOOLS,GODOT_RECEIPTS};
