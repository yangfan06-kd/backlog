// Only this allowlist enters the user delivery. Never bundle profiles or QA logs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='G:/project1',repo=path.resolve(__dirname,'../..'),version=process.argv[2];
if(!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(version||''))throw Error('Explicit public version required');
const release=path.join(root,'output/releases/DS-020','public-'+version),manifest=JSON.parse(fs.readFileSync(path.join(release,'build-manifest.json')));
const delivery=path.join(root,'output/delivery',`ProjectProgress-${version}-Windows-x64`);
if(fs.existsSync(delivery))throw Error('Delivery exists; do not overwrite a published version');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(hash(path.join(release,manifest.setup))!==manifest.setupSha256)throw Error('Setup does not match its manifest');
fs.mkdirSync(delivery,{recursive:true});
const files=[
 [path.join(release,manifest.setup),manifest.setup],
 [path.join(repo,'LICENSE'),'LICENSE.super-productivity.txt'],
 [path.join(release,'win-unpacked/resources/THIRD-PARTY-NOTICES.txt'),'THIRD-PARTY-NOTICES.txt'],
 [path.join(release,'win-unpacked/LICENSE.electron.txt'),'LICENSE.electron.txt'],
 [path.join(release,'win-unpacked/LICENSES.chromium.html'),'LICENSES.chromium.html'],
];
for(const [source,name]of files)fs.copyFileSync(source,path.join(delivery,name),fs.constants.COPYFILE_EXCL);
const write=(name,text)=>fs.writeFileSync(path.join(delivery,name),'\uFEFF'+text.replaceAll('\n','\r\n'),{flag:'wx'});
write('先看这里.txt',`项目进展 ${version} · Windows x64 试用版

一、首次使用
1. 解压整个交付包，双击 ${manifest.setup}，按向导安装。
2. 安装后双击桌面的“项目进展”。基础记录免登录，断网也能使用。
3. 在“四象限总览”安排优先级；在“项目进展”拆分步骤、记录实际完成的事；在“常态事项”持续记录改动、原因和观察。
4. 项目可设未来计划日期。未完成步骤留在右侧，不自动生成完成记录，不自动顺延。
5. 在“项目进展”选择项目后可直接设置分类；“常态事项”在页面上方新建；“备忘”支持文字格式和选填提醒时间，可以选择到时或提前多久提醒。
   软件打开或最小化时，会在所选时间发出一次 Windows 通知；软件完全关闭时不会提醒。到事项时间后，备忘中的时间显示红色。通知还受 Windows 通知设置影响。
6. 在“数据备份”导出完整备份，保存到另一个可靠位置。本机自动备份不能保护磁盘损坏、电脑丢失等情况。

二、以后升级（无需云服务）
1. 先在旧版“数据备份”中导出完整备份，确认文件已保存。
2. 保存编辑内容，关闭项目进展。
3. 下载新版交付包，直接运行新版 Setup，保持原安装位置。不要先删除程序或数据文件夹。
4. 从桌面打开新版，在“关于”查看版本，再检查原记录。
此前版本已用隔离测试数据验证覆盖安装和卸载保留；本版尚未在真实用户数据上验证升级。每次升级前先导出备份。
暂不提供在线自动更新、账号云备份和手机同步。新版由开发者重新发送安装包。

三、从原“项目进展（内测版）”迁移
旧内测版与这个公开试用版使用独立数据，不会自动合并。
1. 在旧内测版导出完整备份，保留旧程序和备份。
2. 安装并打开这个“项目进展”，在“数据备份”选择该备份恢复。
3. 恢复会替换新版当前数据，请先确认新版没有需要另存的记录。
4. 核对项目、步骤、历史记录、常态事项和归档后再决定是否停用旧版。

四、数据在哪里
程序位于所选安装位置的 ProjectProgress 文件夹；数据位于同级 ProjectProgress-data 文件夹。
默认安装位置是当前用户的 LocalAppData\\Programs。卸载程序保留数据。
以后升级保持原安装位置。不要移动或删除 ProjectProgress-data；仅复制程序不等于迁移记录。
换电脑请通过完整备份导出、恢复。桌面快捷方式可用于日常打开。

五、试用反馈
请告诉开发者：版本号、操作步骤、预期与实际结果；截图前遮住私人内容。
请勿默认发送完整业务备份，开发者确需数据排查时再单独沟通。
当前为未签名试用包，Windows 可能显示发布者未知；本交付包不要求关闭系统防护。
本版面向 Windows x64，本轮尚未在其他电脑上实测。移动端后续安排。
`);
write('本版更新.txt',`项目进展 ${version}
日期：2026-11-05

包含：四象限、未来项目计划日期、步骤与完成记录、补记与历史记录直接编辑、常态事项、独立归档、回收站、基础富文本、本机自动备份与完整导出恢复。

本轮补齐：
- 项目进展和常态事项可按住名称上下调整整行顺序；备忘可按住正文上下调整卡片顺序。支持 Alt+上下方向键，保留同一天记录的独立排序。
- 常态事项改为表格附近的宽编辑面板，不再常驻底部；双击历史记录直接修改，补记和历史查询保留。
- 备忘在原卡片内编辑，提醒可明确开启或关闭，选择提醒时间和提前量；“测试提醒”可用于检查这台电脑的 Windows 通知。
- “备忘”列表按钮明确为“全部备忘”，修复主按钮悬停时的文字对比度；“归档与回收站”放在上方功能区的最后一项，紧接“备忘”之后。
- 修复按住记录时稍早移动鼠标导致拖动取消的问题；鼠标按住即可拖动，单击选择和双击编辑保留。
- 同项目同一天内的记录可按住文字后上下拖动排序，或用 Alt+上下方向键；不改日期与实际完成状态。
- 项目进展与常态事项可从“更多”互相转换，原记录、文字格式与剩余步骤保留。
- 界面统一为柔和浅色与炭灰深色，四象限项目排列更清晰，分类入口和同类拖动保留。
- 项目进展页的新建表单按需打开；点击今天的记录入口或双击空白格可记事，补记在日期附近打开。
- 备忘先展示列表，需要新建或修改时打开编辑器，关闭未保存的内容时会提示。
- 项目进展页可以为当前项目设置四象限分类，常态事项的新建入口放在页面上方。
- 备忘支持文字格式、选填提醒时间和提前提醒；软件打开或最小化时发出一次 Windows 通知，到事项时间后显示红色。
- 备忘回收站支持确认后彻底删除；此前的备份文件可能仍包含删除前的内容。
- 四象限内按住项目后可直接拖动调整顺序；项目进展中单击选择项目，双击今天空白格可直接记录，双击已有记录直接编辑；窄窗口下编辑面板保持宽敞，日期较多时可横向滚动。
- 两个撤回入口统一按项目倒序执行，刷新后也遵循同一顺序；编辑过的记录不能直接撤回。
- 常态事项可改名、删除到回收站并恢复原记录。
- 罗马数字步骤编号支持超过十二步。
- 个人工作台停用无关的空闲计时弹窗。
- 可分发的当前用户 Windows 安装包、桌面快捷方式、程序与本机数据分离。
- 同一安装位置覆盖升级，保留已有本机数据，无需云端更新服务。

暂缓：云备份、移动端与跨设备同步、结构化效果分析。
`);
write('开源说明.txt',`本软件基于 Super Productivity 有限二次开发，上游基线 f2ae76045d895994cdac2c519e16eecb4a607e2c。
上游项目：https://github.com/super-productivity/super-productivity
上游采用 MIT License；本包保留其版权和许可文本。
本软件使用 Electron、Chromium、Angular 等开源组件，各组件许可见随附文件。
这些组件的许可文件也随安装程序保留。THIRD-PARTY-NOTICES.txt 为本次前端构建生成的依赖许可汇总。
这是独立试用版本，不代表上游项目的官方发行。
`);
fs.writeFileSync(path.join(delivery,'version.json'),JSON.stringify({version,architecture:'x64',platform:'Windows',appId:manifest.appId,setup:manifest.setup,setupSha256:manifest.setupSha256,automaticUpdates:false,cloudBackup:false},null,2));
const entries=fs.readdirSync(delivery).sort().map(name=>({name,sha256:hash(path.join(delivery,name))}));
write('SHA256SUMS.txt',entries.map(x=>`${x.sha256}  ${x.name}`).join('\n')+'\n');
console.log(JSON.stringify({delivery,files:fs.readdirSync(delivery).length,setupSha256:manifest.setupSha256}));

