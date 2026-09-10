import path from 'node:path';
export function assetClientArguments(args) {
 const allowed=new Set(['--mode','--source-root','--deps-app','--output-parent','--packaged-root','--expected-commit','--expected-build-manifest-sha256']);const result={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.has(key)||Object.hasOwn(result,key)||!value||value.startsWith('--'))throw Error('INVALID_ASSET_CLIENT_ARGUMENT');result[key]=value;}
 if(!['development','packaged'].includes(result['--mode']))throw Error('EXPLICIT_ASSET_CLIENT_MODE_REQUIRED');
 for(const key of ['--source-root','--deps-app','--output-parent'])if(!result[key]||!path.isAbsolute(result[key]))throw Error('ABSOLUTE_ASSET_CLIENT_PATH_REQUIRED');
 if(result['--mode']==='packaged') {
  if(!result['--packaged-root']||!path.isAbsolute(result['--packaged-root'])||!/^[a-f0-9]{40}$/.test(result['--expected-commit']??'')||!/^[a-f0-9]{64}$/.test(result['--expected-build-manifest-sha256']??''))throw Error('PACKAGE_EXPECTED_IDENTITY_REQUIRED');
 } else if(['--packaged-root','--expected-commit','--expected-build-manifest-sha256'].some(k=>Object.hasOwn(result,k)))throw Error('DEVELOPMENT_PACKAGE_OVERRIDE_DENIED');
 return result;
}
