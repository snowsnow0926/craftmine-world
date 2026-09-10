// Test-only issue runner options and read-only frozen package guards.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectParameterPackage,parameterClientArguments} from './parameter-client-package.mjs';

export function issueClientArguments(args){
 const extra=new Set(['--output-root','--core-bin','--host-bin']),values={},common=[];
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];
  if(extra.has(key)){if(Object.hasOwn(values,key)||!value||value.startsWith('--')||!path.isAbsolute(value))throw Error('INVALID_ISSUE_CLIENT_PATH:'+key);values[key]=path.resolve(value);}
  else common.push(key,value);
 }
 const options=parameterClientArguments(common);
 if(options.packaged&&(values['--core-bin']||values['--host-bin']))throw Error('PACKAGED_BINARY_OVERRIDE_DENIED');
 return {...options,outputRoot:values['--output-root']??path.join(options.root,'test-results'),coreBin:values['--core-bin'],hostBin:values['--host-bin']};
}

export function assertIssueSourceIdentity(root,expectedCommit){
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(commit!==expectedCommit)throw Error('ISSUE_SOURCE_COMMIT_CHANGED');
 if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('ISSUE_SOURCE_NOT_CLEAN');
 return commit;
}

export function assertIssuePackageFeatures(main){
 for(const marker of ['issue.followupPrepare','issue.followup'])if(!new RegExp(`["']${marker.replaceAll('.','\\.')}["']`).test(main.toString('utf8')))throw Error('PACKAGE_ISSUE_FEATURE_MISSING:'+marker);
}

export async function inspectIssuePackage(options,previousIdentity){
 assertIssueSourceIdentity(options.root,options.expectedCommit);
 const result=await inspectParameterPackage(options);
 assertIssuePackageFeatures(result.main);
 if(previousIdentity&&JSON.stringify(result.identity)!==JSON.stringify(previousIdentity))throw Error('ISSUE_PACKAGE_CHANGED_BETWEEN_LAUNCHES');
 return result;
}
