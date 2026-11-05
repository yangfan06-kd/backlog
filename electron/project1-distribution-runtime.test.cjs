const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node').register({transpileOnly:true,preferTsExts:true});
const {resolveDistributionRuntime}=require('./project1-distribution-runtime.ts');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-runtime-'));
const program=path.join(root,'StandardUser','Programs','项目进展'),resources=path.join(program,'resources');
const marker=path.join(resources,'project1-distribution.json');
const identity=()=>{fs.mkdirSync(resources,{recursive:true});fs.writeFileSync(marker,JSON.stringify({formatVersion:1,edition:'public'}));};identity();
test('public data is a stable sibling of the installed program',()=>{
 const paths=resolveDistributionRuntime(resources,program);assert.equal(paths.profileRoot,path.join(path.dirname(program),'项目进展-data'));assert(!paths.userData.startsWith(program+path.sep));assert(paths.temp.startsWith(paths.profileRoot+path.sep));
});
test('program replacement does not move or erase the data directory',()=>{
 const a=resolveDistributionRuntime(resources,program);fs.mkdirSync(a.userData,{recursive:true});fs.writeFileSync(path.join(a.userData,'synthetic-records'),'keep');
 assert(path.resolve(program).startsWith(path.resolve(root)+path.sep));fs.rmSync(program,{recursive:true});identity();const b=resolveDistributionRuntime(resources,program);assert.equal(a.userData,b.userData);assert.equal(fs.readFileSync(path.join(b.userData,'synthetic-records'),'utf8'),'keep');
});
test('invalid edition or missing identity fails before data directory creation',()=>{
 fs.writeFileSync(marker,JSON.stringify({formatVersion:2,edition:'public'}));assert.throws(()=>resolveDistributionRuntime(resources,program),/identity/);fs.unlinkSync(marker);assert.throws(()=>resolveDistributionRuntime(resources,program));identity();
});
test('packaged Chinese product identity configures paths before any default Electron store',()=>{
 const Module=require('node:module'),original=Module._load,calls=[];
 const app={isPackaged:false,getName:()=> 'ordinary-test',setPath:(...args)=>calls.push(args),setAppLogsPath:value=>calls.push(['logs',value]),exit:()=>{throw Error('Unexpected app exit');}};
 Module._load=function(request,...args){return request==='electron'?{app}:original.call(this,request,...args);};
 try{
  const runtime=require('./project1-runtime-paths.ts');calls.length=0;app.isPackaged=true;app.getName=()=> '项目进展';const env={};runtime.configureProjectRuntimePaths(env,[],{resourcesPath:resources,programDir:program});
  assert.equal(env.PROJECT1_PREVIEW_MODE,'1');assert.equal(env.PROJECT1_USER_DATA_DIR,path.join(path.dirname(program),'项目进展-data/user-data'));assert(calls.some(([key,value])=>key==='userData'&&value===env.PROJECT1_USER_DATA_DIR));
 }finally{Module._load=original;}
});
test.after(()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true});});
