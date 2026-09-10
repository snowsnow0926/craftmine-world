import path from 'node:path';

export function versionDiffClientArguments(args) {
 const allowed=new Set(['--source-root','--deps-app','--source-core','--world','--output-parent','--packaged-root','--expected-commit','--expected-build-manifest-sha256']);
 const options={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.has(key)||Object.hasOwn(options,key)||!value||value.startsWith('--'))throw Error('INVALID_VM2_ARGUMENT');options[key]=value;}
 for(const key of ['--source-root','--deps-app','--source-core','--world','--output-parent'])if(!options[key])throw Error('MISSING_VM2_ARGUMENT:'+key);
 for(const key of ['--source-root','--deps-app','--source-core','--output-parent','--packaged-root'])if(options[key]&&!path.isAbsolute(options[key]))throw Error('ABSOLUTE_VM2_PATH_REQUIRED:'+key);
 if(options['--packaged-root']) {
  if(!/^[a-f0-9]{40}$/.test(options['--expected-commit']??'')||!/^[a-f0-9]{64}$/.test(options['--expected-build-manifest-sha256']??''))throw Error('PACKAGE_EXPECTED_IDENTITY_REQUIRED');
 } else if(options['--expected-commit']||options['--expected-build-manifest-sha256'])throw Error('VM2_DEVELOPMENT_IDENTITY_OVERRIDE_DENIED');
 return options;
}

/** A selected package can never fall back to a development executable. */
export function versionDiffLaunchPlan({packaged,packageInfo,root,app,electron}) {
 if(packaged) {
  if(!packageInfo?.executable||!packageInfo.core||!packageInfo.host||!packageInfo.bases||!packageInfo.cwd)throw Error('VM2_VERIFIED_PACKAGE_REQUIRED');
  return {executable:packageInfo.executable,args:[],cwd:packageInfo.cwd,core:packageInfo.core,host:packageInfo.host,bases:packageInfo.bases};
 }
 if(packageInfo||!electron)throw Error('VM2_DEVELOPMENT_LAUNCH_INVALID');
 return {executable:electron,args:[app],cwd:root,core:path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:path.join(root,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe'),bases:path.join(root,'desktop/godot')};
}
