const path=require('node:path');
const repo=path.resolve(__dirname,'..'),root='G:/project1';
const version=process.env.PROJECT1_PUBLIC_VERSION;
if(!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(version||''))throw Error('Explicit public version required');
const output=path.join(root,'output/releases/DS-020','public-'+version);
module.exports={
 appId:'local.project1.progress',productName:'项目进展',
 artifactName:'ProjectProgress-Setup-${version}-${arch}.${ext}',
 directories:{output,buildResources:path.join(repo,'build')},
 files:['electron/**/*','!electron/**/*.ts','!electron/**/*.test.cjs','!electron/**/*.js.map','.tmp/angular-dist/browser/**/*','!**/*.map','LICENSE','README.md'],
 extraResources:[
  {from:path.join(repo,'build/project1-distribution.json'),to:'project1-distribution.json'},
  {from:path.join(repo,'LICENSE'),to:'LICENSE.super-productivity.txt'},
  {from:path.join(repo,'.tmp/angular-dist/3rdpartylicenses.txt'),to:'THIRD-PARTY-NOTICES.txt'},
 ],
 extraMetadata:{name:'project-progress',version,productName:'项目进展',project1Preview:true},
 electronDist:path.join(repo,'node_modules/electron/dist'),npmRebuild:false,asar:true,
 win:{target:['nsis'],executableName:'ProjectProgress',signExecutable:false,signAndEditExecutable:true,forceCodeSigning:false,requestedExecutionLevel:'asInvoker'},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:'always',createStartMenuShortcut:false,runAfterFinish:false,deleteAppDataOnUninstall:false,packElevateHelper:false,warningsAsErrors:true,include:path.join(repo,'build/project1-public.nsh'),language:'2052',installerLanguages:['zh_CN'],multiLanguageInstaller:true,uninstallDisplayName:'项目进展',shortcutName:'项目进展'},
};
