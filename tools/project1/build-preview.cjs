'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const projectRoot = 'G:/project1';
const releaseTask = process.env.PROJECT1_RELEASE_TASK || 'DS-010';
const previewVersion = process.env.PROJECT1_PREVIEW_VERSION || '1.0.0-preview.20261027';
const releaseParent = path.join(projectRoot, 'output/releases', releaseTask);
const builderOutput = path.join(repo, '.tmp/project1-preview-build');
const config = path.join(repo, 'build/electron-builder.project1-preview.cjs');
const now = new Date();
const pad = (value) => String(value).padStart(2, '0');
const buildId = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  '-',
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join('');

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${process.execPath} ${args.join(' ')}`);
  }
};

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const npmCli =
  process.env.npm_execpath ||
  'G:/project1/.cache/npm/_npx/531a256430e91eb0/node_modules/npm/bin/npm-cli.js';
if (!fs.existsSync(npmCli)) {
  throw new Error(`npm CLI not found: ${npmCli}`);
}
const builderCli = path.join(repo, 'node_modules/electron-builder/out/cli/cli.js');
if (!fs.existsSync(builderCli)) {
  throw new Error(`electron-builder CLI not found: ${builderCli}`);
}
if (!fs.existsSync(path.join(repo, 'node_modules/electron/dist/electron.exe'))) {
  throw new Error('Local Electron distribution is missing; refusing to download');
}
if (!fs.existsSync(path.join(projectRoot, 'output'))) {
  throw new Error('Project root output directory is missing');
}

fs.mkdirSync(releaseParent, { recursive: true });
let releaseDir = path.join(releaseParent, buildId);
let suffix = 2;
while (fs.existsSync(releaseDir)) {
  releaseDir = path.join(releaseParent, `${buildId}-${suffix++}`);
}

console.log(`[preview] build id: ${path.basename(releaseDir)}`);
const skipSourceBuild = process.env.PROJECT1_PREVIEW_SKIP_SOURCE_BUILD === '1';
if (!skipSourceBuild) {
  run([npmCli, 'run', 'buildFrontend:prod:es6']);
  run([npmCli, 'run', 'electron:build']);
}
run([builderCli, '--config', config, '--dir', '--win', '--x64', '--publish', 'never'], {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
});

const unpacked = path.join(builderOutput, 'win-unpacked');
const exe = path.join(unpacked, 'Project1Preview.exe');
if (!fs.existsSync(exe)) {
  throw new Error(`Expected preview executable not found: ${exe}`);
}
fs.cpSync(unpacked, path.join(releaseDir, 'win-unpacked'), { recursive: true });

const launcherDir = path.join(repo, 'tools/project1');
fs.copyFileSync(
  path.join(launcherDir, 'preview-launcher.cmd'),
  path.join(releaseDir, '启动项目进展内测版.cmd'),
);
fs.copyFileSync(
  path.join(launcherDir, 'preview-launcher.ps1'),
  path.join(releaseDir, 'launch-preview.ps1'),
);
fs.copyFileSync(
  path.join(launcherDir, 'preview-readme.txt'),
  path.join(releaseDir, '使用说明.txt'),
);
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(releaseDir, 'LICENSE'));
fs.copyFileSync(
  path.join(repo, 'README.md'),
  path.join(releaseDir, 'UPSTREAM-README.md'),
);

const packagedExe = path.join(releaseDir, 'win-unpacked/Project1Preview.exe');
const asar = path.join(releaseDir, 'win-unpacked/resources/app.asar');
const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).stdout.trim();
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
const manifest = {
  buildId: path.basename(releaseDir),
  createdAt: now.toISOString(),
  sourceHead: head,
  sourceChanges,
  sourceBuildSkipped: skipSourceBuild,
  sourceBranch: 'project1/minimal-offline',
  appId: 'local.project1.preview',
  name: 'project1-preview',
  productName: '项目进展（内测版）',
  version: previewVersion,
  task: releaseTask,
  executable: 'win-unpacked/Project1Preview.exe',
  executableSha256: sha256(packagedExe),
  asarSha256: sha256(asar),
  asarBytes: fs.statSync(asar).size,
  launcher: '启动项目进展内测版.cmd',
  dataRoot: 'G:/project1/output/runtime/project1-preview',
  packageType: 'windows-x64-unpacked-directory-preview',
  signed: false,
  installerIncluded: false,
};
fs.writeFileSync(
  path.join(releaseDir, 'build-manifest.json'),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest, null, 2));
console.log(`[preview] release: ${releaseDir}`);
