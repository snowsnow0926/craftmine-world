// Broker routing tables, kept separate from the broker so the capability
// inventory and the tests can read them without loading the generated domain
// bundle. This module has no host dependency of its own.
'use strict';

// Every Godot tool that reaches a host method.
const GODOT_METHODS={godot_project_create:'godotProject.create',godot_project_index:'godotProject.index',
  godot_file_read:'godotProject.read',godot_project_patch:'godotProject.patch',
  godot_asset_put:'godotAsset.put',godot_asset_list:'godotAsset.list',
  godot_build_start:'godotBuild.start',godot_build_read:'godotBuild.read',godot_build_cancel:'godotBuild.cancel',
  godot_candidate_read:'godotCandidate.read',godot_candidate_list:'godotCandidate.list'};

// Tools implemented inside this plugin. They still reach only host methods the
// core advertises; none of them is a new execution path.
const LOCAL_TOOLS={
  godot_docs:{owner:'L',hostMethod:null,reachable:true},
  godot_project_query:{owner:'L',hostMethod:'godotProject.index+godotProject.read',reachable:true},
  godot_runtime_state:{owner:'L',hostMethod:'godotRuntime.describe',reachable:null},
  godot_project_facts:{owner:'L',hostMethod:'godotProject.index+godotCandidate.list+godotRuntime.describe',reachable:null},
  godot_capability_report:{owner:'L',hostMethod:'hello',reachable:true},
  godot_history:{owner:'L',hostMethod:'version.*/asset.*',reachable:false,blockedBy:'DEPENDENCY_NOT_WIRED'}};

// Only these calls change durable state; a discussion turn must not run them.
const WRITE_TOOLS=new Set(['godot_project_create','godot_project_patch','godot_asset_put','godot_build_start',
  'workspace_patch','library_install','verification_submit','memory_propose']);

const GODOT_RECEIPTS={'godotProject.create':'godotProject.receipt','godotProject.patch':'godotProject.receipt',
  'godotAsset.put':'godotBuild.receipt','godotBuild.start':'godotBuild.receipt'};

module.exports={GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS,GODOT_RECEIPTS};
