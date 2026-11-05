'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const projectRoot = 'G:/project1';
const releaseTask = process.env.PROJECT1_RELEASE_TASK || 'DS-011';
const version = process.env.PROJECT1_INSTALLER_VERSION || '1.0.0-preview.20261028';
const intendedUse = process.env.PROJECT1_INSTALLER_INTENDED_USE || 'daily';
if (!['daily', 'validation'].includes(intendedUse))
  throw new Error('Invalid installer intendedUse');
const releaseParent = path.join(projectRoot, 'output/releases', releaseTask);
const builderOutput = process.env.PROJECT1_INSTALLER_BUILD_DIR
  ? path.resolve(process.env.PROJECT1_INSTALLER_BUILD_DIR)
  : path.join(repo, '.tmp/project1-installer-build');
const stubWorkdir = path.join(projectRoot, '.tmp/project1-installer-stub');
const installedApp = path.join(projectRoot, 'output/installed/project1-preview/app');
const configFile = path.join(repo, 'build/electron-builder.project1-installer.cjs');
const includeFile = path.join(repo, 'build/project1-installer.nsh');
const policyFile = process.env.PROJECT1_INSTALLER_POLICY_FILE
  ? path.resolve(process.env.PROJECT1_INSTALLER_POLICY_FILE)
  : path.join(repo, 'build/project1-runtime-installer.json');
const builderCli = path.join(repo, 'node_modules/electron-builder/out/cli/cli.js');
const npmCli =
  process.env.npm_execpath ||
  'G:/project1/.cache/npm/_npx/531a256430e91eb0/node_modules/npm/bin/npm-cli.js';
const logRoot = process.env.PROJECT1_INSTALLER_LOG_DIR
  ? path.resolve(process.env.PROJECT1_INSTALLER_LOG_DIR)
  : path.join(projectRoot, 'output/runtime', releaseTask);
const logDir = path.join(logRoot, `installer-build-${Date.now()}`);
const buildLog = path.join(logDir, 'installer-build.log');

const pad = (value) => String(value).padStart(2, '0');
const now = new Date();
const buildId = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  '-',
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join('');

const assertInsideProject = (target, parent) => {
  const resolved = path.resolve(target);
  const root = path.resolve(parent);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside ${root}: ${resolved}`);
  }
  let current = resolved;
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Refusing linked build output: ${current}`);
    const parentDir = path.dirname(current);
    if (parentDir === current) break;
    current = parentDir;
  }
};

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// An override is a disposable build directory, never a profile or runtime root.
const assertInstallerBuilderOutput = (target, task = releaseTask) => {
  if (!['DS-017', 'DS-018', 'DS-019'].includes(task)) throw new Error('Installer build override requires a reviewed task');
  const taskRoot = path.resolve(projectRoot, `output/runtime/${task}`);
  const relative = path.relative(taskRoot, path.resolve(target));
  if (
    !/^(?:validation|daily)-build(?:-[a-z0-9]+)*[\\/]builder-output$/i.test(relative)
  ) {
    throw new Error(`Installer build override must be a ${task} validation/daily build directory`);
  }
  assertInsideProject(target, taskRoot);
};

const run = (args, extraEnv = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  fs.appendFileSync(
    buildLog,
    `\n$ ${process.execPath} ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}\n`,
  );
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${args.join(' ')}`);
  }
  return result;
};

const findFiles = (dir, predicate) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(full, predicate);
    return predicate(full) ? [full] : [];
  });
};

// DS-018 builds updates while the prior app remains installed. Read program
// files only; never inspect the separate real-user profile.
const snapshotInstalledProgram = () => {
  assertInsideProject(installedApp, path.join(projectRoot, 'output/installed'));
  if (!fs.existsSync(installedApp)) return null;
  const rows = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`Linked installed program entry: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) rows.push({ path: path.relative(installedApp, file), bytes: stat.size, sha256: sha256(file) });
      else throw new Error(`Unsupported installed program entry: ${file}`);
    }
  };
  visit(installedApp);
  return rows;
};

const recordNsisCache = () =>
  findFiles(path.join(projectRoot, '.cache/electron-builder'), (file) =>
    /nsis|makensis/i.test(file),
  ).map((file) => ({
    path: path.relative(projectRoot, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
    sha256: sha256(file),
  }));

const main = () => {
  if (process.env.PROJECT1_INSTALLER_BUILD_DIR)
    assertInstallerBuilderOutput(builderOutput);
  assertInsideProject(logDir, projectRoot);
  assertInsideProject(releaseParent, path.join(projectRoot, 'output/releases'));
  assertInsideProject(policyFile, projectRoot);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(buildLog, `${releaseTask} installer build ${now.toISOString()}\n`);
  if (!fs.existsSync(npmCli)) throw new Error(`npm CLI not found: ${npmCli}`);
  if (!fs.existsSync(builderCli))
    throw new Error(`electron-builder CLI not found: ${builderCli}`);
  if (!fs.existsSync(path.join(repo, 'node_modules/electron/dist/electron.exe'))) {
    throw new Error('Local Electron distribution is missing; refusing to download');
  }
  for (const file of [configFile, includeFile, policyFile]) {
    if (!fs.existsSync(file)) throw new Error(`Missing installer input: ${file}`);
  }
  let policyText = fs.readFileSync(policyFile, 'utf8');
  if (policyText.charCodeAt(0) === 0xfeff) policyText = policyText.slice(1);
  const policy = JSON.parse(policyText);
  if (!path.isAbsolute(policy.storageRoot) || !path.isAbsolute(policy.profileRoot))
    throw new Error('Runtime policy paths must be absolute');
  assertInsideProject(policy.profileRoot, projectRoot);
  const isIsolatedTestPolicy =
    path.resolve(policyFile) !==
    path.resolve(repo, 'build/project1-runtime-installer.json');
  if (
    policy.formatVersion !== 1 ||
    path.resolve(policy.storageRoot) !== path.resolve(projectRoot)
  ) {
    throw new Error('Candidate runtime policy has an invalid storage root/version');
  }
  if (isIsolatedTestPolicy) {
    const isolatedTask =
      ['DS-017', 'DS-018', 'DS-019'].includes(releaseTask) ? releaseTask : releaseTask === 'DS-014' ? 'DS-014' : 'DS-012';
    const testRoot = path.resolve(projectRoot, `output/runtime/${isolatedTask}`);
    const profile = path.resolve(policy.profileRoot);
    const fixedValidationProfile =
      ['DS-017', 'DS-018', 'DS-019'].includes(releaseTask)
        ? path.resolve(projectRoot, `output/runtime/${releaseTask}/validation/profile`)
        : releaseTask === 'DS-014'
          ? path.resolve(projectRoot, 'output/runtime/DS-014/validation/profile')
          : path.resolve(projectRoot, 'output/runtime/DS-012/DS-013-validation/profile');
    if (
      !path.resolve(policyFile).startsWith(testRoot + path.sep) ||
      !profile.startsWith(testRoot + path.sep) ||
      profile === path.resolve(projectRoot, 'output/runtime/project1-preview')
    ) {
      throw new Error(
        `Isolated test policy must stay under output/runtime/${isolatedTask}`,
      );
    }
    if (intendedUse === 'validation' && profile !== fixedValidationProfile) {
      throw new Error(
        'Validation candidate must use its fixed isolated validation profile',
      );
    }
    if (intendedUse !== 'validation') {
      throw new Error('Daily candidate must not use an isolated test policy');
    }
  } else if (
    path.resolve(policy.profileRoot) !==
    path.resolve(projectRoot, 'output/runtime/project1-preview')
  ) {
    throw new Error('Candidate runtime policy is not the reviewed current policy');
  } else if (intendedUse !== 'daily') {
    throw new Error('Validation candidate must use the isolated test policy');
  }

  // Only our own temporary builder directories may be replaced. Releases,
  // installed candidates and profiles are never deleted by this script.
  for (const target of [builderOutput, stubWorkdir]) {
    assertInsideProject(
      target,
      target === stubWorkdir
        ? path.join(projectRoot, '.tmp')
        : process.env.PROJECT1_INSTALLER_BUILD_DIR
          ? path.join(projectRoot, 'output/runtime')
          : path.join(repo, '.tmp'),
    );
    fs.rmSync(target, { recursive: true, force: true });
  }
  const installedExisted = fs.existsSync(installedApp);
  if (installedExisted && !['DS-018', 'DS-019'].includes(releaseTask)) {
    throw new Error(
      `Refusing to build while an installed app already exists: ${installedApp}`,
    );
  }
  const installedProgramBefore = installedExisted ? snapshotInstalledProgram() : null;

  fs.mkdirSync(releaseParent, { recursive: true });
  let releaseDir = path.join(releaseParent, `${buildId}-${intendedUse}`);
  let suffix = 2;
  while (fs.existsSync(releaseDir))
    releaseDir = path.join(releaseParent, `${buildId}-${intendedUse}-${suffix++}`);

  const cacheBefore = recordNsisCache();
  const sourceBuildSkipped = process.env.PROJECT1_INSTALLER_SKIP_SOURCE_BUILD === '1';
  if (sourceBuildSkipped) {
    if (
      !fs.existsSync(path.join(repo, '.tmp/angular-dist/browser/index.html')) ||
      !fs.existsSync(path.join(repo, 'electron/main.js'))
    )
      throw new Error('Cannot skip source build without compiled frontend/Electron output');
  } else {
    run([npmCli, 'run', 'buildFrontend:prod:es6']);
    run([npmCli, 'run', 'electron:build']);
  }
  run(
    [builderCli, '--config', configFile, '--win', 'nsis', '--x64', '--publish', 'never'],
    {
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      PROJECT1_INSTALLER_VERSION: version,
      DEBUG: 'electron-builder',
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS || ''} --require ${path.join(repo, 'tools/project1/nsis-audit-preload.cjs')}`.trim(),
      PROJECT1_NSIS_AUDIT_DIR: path.join(builderOutput, 'compiler-audit'),
    },
  );

  const setupFiles = fs
    .readdirSync(builderOutput)
    .filter((name) => /^Project1Preview-Setup-.*\.exe$/i.test(name))
    .map((name) => path.join(builderOutput, name));
  if (setupFiles.length !== 1) {
    throw new Error(`Expected exactly one Setup candidate, found ${setupFiles.length}`);
  }
  const unpacked = path.join(builderOutput, 'win-unpacked');
  const unpackedExe = path.join(unpacked, 'Project1Preview.exe');
  if (!fs.existsSync(unpackedExe))
    throw new Error(`Missing unpacked executable: ${unpackedExe}`);
  const packagedPolicy = path.join(unpacked, 'resources', 'project1-runtime.json');
  if (!fs.existsSync(packagedPolicy))
    throw new Error(`Missing packaged runtime policy: ${packagedPolicy}`);
  const packagedPolicyJson = JSON.parse(fs.readFileSync(packagedPolicy, 'utf8'));
  if (
    packagedPolicyJson.formatVersion !== policy.formatVersion ||
    path.resolve(packagedPolicyJson.storageRoot) !== path.resolve(policy.storageRoot) ||
    path.resolve(packagedPolicyJson.profileRoot) !== path.resolve(policy.profileRoot)
  ) {
    throw new Error('Packaged runtime policy differs from the reviewed input');
  }
  const installedProgramAfter = snapshotInstalledProgram();
  if (JSON.stringify(installedProgramBefore) !== JSON.stringify(installedProgramAfter)) {
    throw new Error(
      `Installer build changed the installed program directory: ${installedApp}`,
    );
  }

  fs.cpSync(unpacked, path.join(releaseDir, 'win-unpacked'), { recursive: true });
  fs.copyFileSync(setupFiles[0], path.join(releaseDir, path.basename(setupFiles[0])));
  fs.copyFileSync(policyFile, path.join(releaseDir, 'project1-runtime.json'));
  fs.copyFileSync(
    configFile,
    path.join(releaseDir, 'electron-builder.project1-installer.cjs'),
  );
  fs.copyFileSync(includeFile, path.join(releaseDir, 'project1-installer.nsh'));
  for (const extraInclude of ['project1-install-mode.nsh', 'project1-installer-copy.nsh'])
    fs.copyFileSync(
      path.join(repo, 'build', extraInclude),
      path.join(releaseDir, extraInclude),
    );
  fs.cpSync(
    path.join(builderOutput, 'compiler-audit'),
    path.join(releaseDir, 'compiler-audit'),
    { recursive: true },
  );
  const debugFile = path.join(builderOutput, 'builder-debug.yml');
  if (!fs.existsSync(debugFile)) throw new Error('Missing NSIS compiler input audit');
  fs.copyFileSync(debugFile, path.join(releaseDir, 'builder-debug.yml'));
  const debug = require('js-yaml').load(fs.readFileSync(debugFile, 'utf8'));
  if (typeof debug?.nsis?.script !== 'string')
    throw new Error('Missing recorded NSIS script');
  fs.writeFileSync(path.join(releaseDir, 'compiler-input.nsi'), debug.nsis.script);
  fs.copyFileSync(buildLog, path.join(releaseDir, 'build.log'));
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(releaseDir, 'LICENSE'));
  fs.copyFileSync(
    path.join(repo, 'README.md'),
    path.join(releaseDir, 'UPSTREAM-README.md'),
  );

  const entriesDir = path.join(repo, 'tools/project1/entries');
  const entrySpecs =
    intendedUse === 'validation'
      ? [
          ['package-launcher.ps1', 'package-launcher.ps1'],
          ['validation-start.cmd', '验证启动.cmd'],
          ['validation-check.cmd', '验证检查.cmd'],
          ['validation-readme.txt', '验证说明.txt'],
        ]
      : [
          ['package-launcher.ps1', 'package-launcher.ps1'],
          ['daily-install.cmd', '安装.cmd'],
          ['daily-start.cmd', '启动.cmd'],
          ['daily-uninstall.cmd', '卸载.cmd'],
          ['daily-check.cmd', '检查.cmd'],
          ['daily-readme.txt', '使用说明.txt'],
        ];
  const entryFiles = entrySpecs.map(([source, destination]) => {
    fs.copyFileSync(path.join(entriesDir, source), path.join(releaseDir, destination));
    return destination;
  });

  const setup = path.join(releaseDir, path.basename(setupFiles[0]));
  const releaseExe = path.join(releaseDir, 'win-unpacked/Project1Preview.exe');
  const asar = path.join(releaseDir, 'win-unpacked/resources/app.asar');
  const changedPaths = [
    ...new Set(
      [
        ...spawnSync('git', ['diff', '--name-only', '-z', 'HEAD'], {
          cwd: repo,
          encoding: 'utf8',
        }).stdout.split('\0'),
        ...spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
          cwd: repo,
          encoding: 'utf8',
        }).stdout.split('\0'),
      ].filter(Boolean),
    ),
  ].sort();
  const sourceChanges = changedPaths.map((relativePath) => {
    const file = path.join(repo, relativePath);
    return { path: relativePath, sha256: fs.existsSync(file) ? sha256(file) : null };
  });
  const stubEntries = fs.existsSync(stubWorkdir)
    ? fs.readdirSync(stubWorkdir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
      }))
    : [];
  const cacheAfter = recordNsisCache();
  const manifest = {
    buildId: path.basename(releaseDir),
    createdAt: now.toISOString(),
    task: releaseTask,
    intendedUse,
    policyKind:
      intendedUse === 'validation'
        ? ['DS-017', 'DS-018', 'DS-019'].includes(releaseTask)
          ? `isolated-${releaseTask.toLowerCase().replace('-', '')}-validation`
          : 'isolated-ds012-validation'
        : 'daily-default',
    aStageLaunchAllowed: intendedUse === 'validation',
    productName: '项目进展（内测版）',
    appId: 'local.project1.preview',
    name: 'project1-preview',
    version,
    packageType: 'windows-x64-nsis-installer-candidate',
    entryFiles,
    entryHashes: entryFiles.map((name) => ({
      path: name,
      sha256: sha256(path.join(releaseDir, name)),
    })),
    setup: path.basename(setup),
    setupSha256: sha256(setup),
    setupBytes: fs.statSync(setup).size,
    executable: 'win-unpacked/Project1Preview.exe',
    executableSha256: sha256(releaseExe),
    asarSha256: sha256(asar),
    asarBytes: fs.statSync(asar).size,
    uninstallerSha256: sha256(
      path.join(releaseDir, 'compiler-audit/reviewed-uninstaller.exe'),
    ),
    runtimePolicy: 'project1-runtime.json',
    runtimePolicySha256: sha256(path.join(releaseDir, 'project1-runtime.json')),
    configSha256: sha256(configFile),
    includeSha256: sha256(includeFile),
    sourceHead: spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim(),
    sourceChanges,
    sourceBuildSkipped,
    installerRun: false,
    uninstallRun: false,
    signed: false,
    stubWorkdir: path.relative(projectRoot, stubWorkdir).split(path.sep).join('/'),
    stubEntries,
    installedAppCreated: !installedExisted && fs.existsSync(installedApp),
    installedProgramPreserved: installedExisted,
    installedProgramBefore,
    installedProgramAfter,
    nsisCacheBefore: cacheBefore,
    nsisCacheAfter: cacheAfter,
    builderOutput: path.relative(projectRoot, builderOutput).split(path.sep).join('/'),
    buildLog: path.relative(projectRoot, buildLog).split(path.sep).join('/'),
  };
  fs.writeFileSync(
    path.join(releaseDir, 'build-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(releaseDir, '候选说明.txt'),
    [
      '项目进展（内测版）Windows x64 安装候选包',
      '本轮仅构建候选，未运行 Setup/Uninstall，未写注册表、开始菜单或桌面。',
      `版本：${version}`,
      '身份：project1-preview / local.project1.preview / 项目进展（内测版），未签名。',
      '程序目录固定为 G:/project1/output/installed/project1-preview/app。',
      `数据目录由 resources/project1-runtime.json 指向 ${policy.profileRoot}；`,
      '安装/卸载不删除该数据目录。',
      '安装器仅当前用户、不请求提权、创建桌面快捷方式、不完成后自启动、不注册协议/关联/开机启动。',
      '真实安装/升级/卸载和系统写入清单仍需主 agent 审查后再执行。',
    ].join('\r\n'),
  );
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`[installer] release: ${releaseDir}`);
};

module.exports = { assertInstallerBuilderOutput };
if (require.main === module) main();
