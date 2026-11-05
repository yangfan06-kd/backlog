const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const dir=path.join('G:/project1/output/runtime/DS-017',`entry-fixtures-${Date.now()}`);
const launcher=process.env.PROJECT1_ENTRIES_TEST_SOURCE || path.join(__dirname,'entries/package-launcher.ps1');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(name, options={}){
 const folder=path.join(dir,name);fs.mkdirSync(path.join(folder,'win-unpacked/resources'),{recursive:true});
 fs.copyFileSync(launcher,path.join(folder,'package-launcher.ps1'));
 fs.writeFileSync(path.join(folder,'setup.exe'),'inert setup, never execute');
 fs.writeFileSync(path.join(folder,'win-unpacked/Project1Preview.exe'),'inert executable, never execute');
 fs.writeFileSync(path.join(folder,'win-unpacked/resources/app.asar'),'expected business content');
 const policy=options.policy || {formatVersion:1,storageRoot:'G:/project1',profileRoot:'G:/project1/output/runtime/project1-preview'};
 fs.writeFileSync(path.join(folder,'win-unpacked/resources/project1-runtime.json'),JSON.stringify(policy));
 const manifest={task:'DS-012',intendedUse:'daily',name:'project1-preview',appId:'local.project1.preview',version:'1.0.7-preview.20261030',setup:'setup.exe',setupSha256:hash(path.join(folder,'setup.exe')),executableSha256:hash(path.join(folder,'win-unpacked/Project1Preview.exe')),asarSha256:hash(path.join(folder,'win-unpacked/resources/app.asar')),runtimePolicySha256:hash(path.join(folder,'win-unpacked/resources/project1-runtime.json')),uninstallerSha256:'a'.repeat(64),...options.manifest};
 fs.writeFileSync(path.join(folder,'build-manifest.json'),JSON.stringify(manifest));return{folder,manifest,policy};
}
function run(folder,extra=[]){const env={...process.env};delete env.PSModulePath;return cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(folder,'package-launcher.ps1'),'-Mode','Check',...extra],{encoding:'utf8',env});}
test('valid inert package check succeeds without execution',()=>{const f=fixture('valid');const r=run(f.folder);assert.equal(r.status,0,r.stdout+r.stderr);});
test('business archive tampering is rejected before execution',()=>{const f=fixture('bad-asar');fs.appendFileSync(path.join(f.folder,'win-unpacked/resources/app.asar'),'tamper');const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
test('policy bytes differing from manifest are rejected',()=>{const f=fixture('bad-policy-hash');fs.appendFileSync(path.join(f.folder,'win-unpacked/resources/project1-runtime.json'),' ');const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
test('unknown package purpose is rejected',()=>{const f=fixture('bad-purpose');f.manifest.intendedUse='oops';fs.writeFileSync(path.join(f.folder,'build-manifest.json'),JSON.stringify(f.manifest));const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
test('explicit CheckOnly parameter remains read only',()=>{const f=fixture('checkonly');const r=run(f.folder,['-CheckOnly']);assert.equal(r.status,0,r.stdout+r.stderr);});
test('DS-017 validation package uses only its fixed profile',()=>{const f=fixture('ds017-valid',{manifest:{task:'DS-017',intendedUse:'validation',version:'1.0.26-preview.20261031'},policy:{formatVersion:1,storageRoot:'G:/project1',profileRoot:'G:/project1/output/runtime/DS-017/validation/profile'}});const r=run(f.folder);assert.equal(r.status,0,r.stdout+r.stderr);});
test('DS-017 validation package cannot use the daily profile',()=>{const f=fixture('ds017-wrong-policy',{manifest:{task:'DS-017',intendedUse:'validation',version:'1.0.26-preview.20261031'}});const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
test('DS-017 daily package remains read-only checkable',()=>{const f=fixture('ds017-daily',{manifest:{task:'DS-017',intendedUse:'daily',version:'1.0.26-preview.20261031'}});const r=run(f.folder);assert.equal(r.status,0,r.stdout+r.stderr);});
test('unknown task is rejected before execution',()=>{const f=fixture('unknown-task',{manifest:{task:'DS-999',intendedUse:'daily'}});const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
test('DS-018 daily package remains read-only checkable',()=>{const f=fixture('ds018-daily',{manifest:{task:'DS-018',intendedUse:'daily',version:'1.0.28-preview.20261101'}});const r=run(f.folder);assert.equal(r.status,0,r.stdout+r.stderr);});
test('DS-019 daily package remains read-only checkable',()=>{const f=fixture('ds019-daily',{manifest:{task:'DS-019',intendedUse:'daily',version:'1.0.46-preview.20261101'}});const r=run(f.folder);assert.equal(r.status,0,r.stdout+r.stderr);});
test('DS-018 validation refuses the real daily data directory',()=>{const f=fixture('ds018-wrong-policy',{manifest:{task:'DS-018',intendedUse:'validation',version:'1.0.28-preview.20261101'}});const r=run(f.folder);assert.equal(r.status,1,r.stdout+r.stderr);});
