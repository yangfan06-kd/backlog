'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = 'G:/project1';
const repo = path.join(root, 'repos/project1-desktop');
const id = 'ui016-20261031-1930';
const version = '1.0.24-preview.20261031';
const release = path.join(root, 'output/releases/DS-016', id);
const runRoot = path.join(root, 'output/runtime/DS-016', id);
const handoff = path.join(root, 'output/handoffs/DS-016');
const baselineDir = path.join(root, 'output/baselines/DS-015-reviewed-final-20261031');
const sha = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (name, value) =>
  fs.writeFileSync(path.join(handoff, name), JSON.stringify(value, null, 2), 'utf8');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const walk = (dir) => {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
};

fs.mkdirSync(handoff, { recursive: true });

const manifest = JSON.parse(
  fs.readFileSync(path.join(baselineDir, 'manifest.json'), 'utf8'),
);
const changed = [];
const missing = [];
let snapshotMismatch = 0;
for (const entry of manifest) {
  const snap = path.join(baselineDir, 'files', entry.path);
  const current = path.join(repo, entry.path);
  if (!fs.existsSync(snap) || sha(snap) !== entry.sha256) snapshotMismatch++;
  if (!fs.existsSync(current)) {
    missing.push(entry.path);
    continue;
  }
  if (sha(current) !== entry.sha256) changed.push(entry.path);
}
const baselineCheck = {
  baseline: 'DS-015-reviewed-final-20261031',
  files: manifest.length,
  snapshotHashMismatch: snapshotMismatch,
  currentChanged: changed.length,
  currentChangedPaths: changed.sort(),
  missing,
};
write('baseline-189-check.json', baselineCheck);

const sourceFiles = [
  'src/app/features/personal-overview/personal-overview-page.component.html',
  'src/app/features/personal-overview/personal-overview-page.component.scss',
  'src/app/features/personal-routine/personal-routine-page.component.html',
  'src/app/features/personal-routine/personal-routine-page.component.ts',
  'src/app/features/personal-routine/personal-routine-page.component.scss',
  'src/app/features/personal-archive/personal-archive-page.component.html',
  'src/app/features/personal-archive/personal-archive-page.component.scss',
  'src/app/features/personal-workspace/personal-backup-page.component.html',
  'src/app/features/personal-workspace/personal-backup-page.component.ts',
  'src/app/features/personal-workspace/personal-backup-page.component.scss',
  'src/styles/components/_personal-workspace.scss',
  'src/assets/i18n/en.json',
  'src/assets/i18n/zh.json',
  'e2e/tests/personal-progress/ui-consistency.spec.ts',
  'tools/project1/electron-ds016-review.cjs',
  'docs/project1-minimal-offline.md',
  'docs/wiki/3.03-Keyboard-Shortcuts.md',
  'docs/wiki/3.09-Theming.md',
];
const source = sourceFiles.map((file) => ({
  path: file,
  sha256: sha(path.join(repo, file)),
}));

const packageFiles = walk(path.join(release, 'win-unpacked'));
const exe = path.join(release, 'win-unpacked/Project1Preview.exe');
const asar = path.join(release, 'win-unpacked/resources/app.asar');
const packagePolicy = path.join(release, 'win-unpacked/resources/project1-runtime.json');
const runtimePolicy = path.join(runRoot, 'runtime-policy.json');

const extract = path.join(runRoot, 'asar-extract');
if (!fs.existsSync(path.join(extract, '.tmp/angular-dist/browser'))) {
  throw new Error('asar extract missing; run npx asar extract first');
}
const dist = path.join(repo, '.tmp/angular-dist/browser');
const asarDist = path.join(extract, '.tmp/angular-dist/browser');
const asarFrontendFiles = walk(asarDist).map((file) => path.relative(asarDist, file));
let asarMismatch = [];
let distOnly = [];
for (const rel of asarFrontendFiles) {
  const packaged = path.join(asarDist, rel);
  const built = path.join(dist, rel);
  if (!fs.existsSync(built) || sha(packaged) !== sha(built)) asarMismatch.push(rel);
}
const distRel = walk(dist).map((file) => path.relative(dist, file));
for (const rel of distRel) {
  if (!asarFrontendFiles.includes(rel)) distOnly.push(rel);
}
const asarBinding = {
  release,
  asarSha256: sha(asar),
  packageFileCount: packageFiles.length,
  packageBytes: packageFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
  frontendPackagedFiles: asarFrontendFiles.length,
  frontendHashMismatches: asarMismatch,
  distOnlyFiles: distOnly.length,
  distOnlyKinds: {
    sourceMaps: distOnly.filter((file) => file.endsWith('.map')).length,
    other: distOnly.filter((file) => !file.endsWith('.map')),
  },
  policyMatchesRuntimePolicy: sha(packagePolicy) === sha(runtimePolicy),
  packagePolicy: JSON.parse(fs.readFileSync(packagePolicy, 'utf8')),
};
write('asar-binding.json', asarBinding);

const actual = JSON.parse(
  fs.readFileSync(path.join(runRoot, 'desktop-review.json'), 'utf8'),
);

const sourceBinding = {
  task: 'DS-016',
  generatedAt: new Date().toISOString(),
  version,
  buildId: id,
  release,
  baselineCheck,
  sourceFiles: source,
  directoryConfig: {
    path: 'docs/tasks/DS-016-DIRECTORY.config.cjs',
    sha256: sha(path.join(root, 'docs/tasks/DS-016-DIRECTORY.config.cjs')),
  },
  runtimePolicy: {
    path: runtimePolicy,
    sha256: sha(runtimePolicy),
    value: JSON.parse(fs.readFileSync(runtimePolicy, 'utf8')),
  },
  package: {
    exeSha256: sha(exe),
    asarSha256: sha(asar),
    policySha256: sha(packagePolicy),
    packageFileCount: packageFiles.length,
  },
  buildLogs: {
    frontend: {
      path: path.join(runRoot, 'frontend-build.log'),
      sha256: sha(path.join(runRoot, 'frontend-build.log')),
    },
    electron: {
      path: path.join(runRoot, 'electron-build.log'),
      sha256: sha(path.join(runRoot, 'electron-build.log')),
    },
    directory: {
      path: path.join(runRoot, 'directory-build.log'),
      sha256: sha(path.join(runRoot, 'directory-build.log')),
    },
  },
  actualReview: {
    path: path.join(runRoot, 'desktop-review.json'),
    sha256: sha(path.join(runRoot, 'desktop-review.json')),
    ok: actual.ok,
  },
};
write('source-binding.json', sourceBinding);

const screenshotNames = actual.screenshots.map((file) => path.basename(file));
const postState = {
  checkedAt: new Date().toISOString(),
  registry: {
    hkcuProject: fs.existsSync('HKCU:\\Software\\290aebf5-3202-5614-9d01-a47534d2699d'),
    hkcuUninstall: fs.existsSync(
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\290aebf5-3202-5614-9d01-a47534d2699d',
    ),
    hklmProject: fs.existsSync('HKLM:\\Software\\290aebf5-3202-5614-9d01-a47534d2699d'),
    hklmUninstall: fs.existsSync(
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\290aebf5-3202-5614-9d01-a47534d2699d',
    ),
  },
  installedApp: fs.existsSync(path.join(root, 'output/installed/project1-preview/app')),
  releaseSetupExe: fs
    .readdirSync(release)
    .filter((name) => name.toLowerCase().endsWith('.exe')).length,
  defaultProfileExists: fs.existsSync(path.join(root, 'output/runtime/project1-preview')),
  ds016ProfileExists: fs.existsSync(path.join(runRoot, 'profile')),
  restoreProfileExists: fs.existsSync(path.join(runRoot, 'profile-restore')),
};
write('post-state.json', postState);

const checks = {
  task: 'DS-016',
  model: 'deepseek-flash (runtime self-report; not independently verified)',
  baseline: baselineCheck,
  build: {
    version,
    buildId: id,
    release,
    directoryOnly: true,
    setupBuilt: false,
    installerRun: false,
    exeSha256: sha(exe),
    asarSha256: sha(asar),
    policySha256: sha(packagePolicy),
    packageFileCount: packageFiles.length,
    packageBytes: asarBinding.packageBytes,
  },
  lint: {
    checkFile: 'passed; all modified TS/SCSS/spec/tools in one call',
    prettierI18n: 'passed',
    lintCssVars: 'passed',
  },
  unit: { testAffected: '18800 SUCCESS + 6349 SUCCESS' },
  e2e: {
    fullPersonal:
      '110 passed (16 files; personal-progress 8, overview 2, routine 3, archive 1, workspace 2)',
    postBuildFocused: '5 passed (backup.spec + ui-consistency.spec)',
    layoutStress:
      '2 passed; 20 routine rows, 40 history dates, sticky, keyboard, restore triggers',
  },
  actual: {
    ok: actual.ok,
    rows: 20,
    historyDates: 40,
    navWidth: 200,
    headingSizes: '28px at 1280/1440/1600; 22px at 1024 on all four pages',
    pageWidths: 'no document horizontal overflow at 1280/1440/1600/1024',
    routineSticky:
      'item and today x stable <=2px after horizontal scroll; header sticky within 1px after vertical scroll',
    overviewSteps: 'one line scrolls (scrollWidth > clientWidth)',
    fonts:
      'item title, date, range button, entry text and page headings all report Microsoft YaHei UI stack',
    backupStatusRegions: 1,
    restoreButtons:
      'routine and backup triggers are BUTTON elements reached by Space/Enter',
    offlineReopen:
      '3 projects / 20 routine items / 1 archive card persisted after normal close and reopen',
    fullBackup:
      'exported 55750 bytes; independent profile restore yielded 3 projects / 20 routine items',
    screenshots: screenshotNames,
  },
  notRun: [
    'NSIS/Setup/Uninstall or registry write',
    'real default profile read or launch',
    'full Settings theme-switch workflow (dark was exercised by the real body theme classes)',
    'mobile layout',
    'full native IME retest (DS-014 evidence remains historical)',
    'main-agent visual/semantic acceptance',
  ],
};
write('checks.json', checks);

copy(
  path.join(runRoot, 'desktop-review.json'),
  path.join(handoff, 'desktop-review.json'),
);
copy(path.join(runRoot, 'actual-review.log'), path.join(handoff, 'desktop-review.log'));
copy(path.join(runRoot, 'full-backup.json'), path.join(handoff, 'full-backup.json'));
copy(
  path.join(runRoot, 'runtime-policy.json'),
  path.join(handoff, 'runtime-policy.json'),
);
copy(
  path.join(root, 'docs/tasks/DS-016-DIRECTORY.config.cjs'),
  path.join(handoff, 'DS-016-DIRECTORY.config.cjs'),
);
copy(
  path.join(root, 'output/handoffs/CX-016-PREPARATION/preflight.json'),
  path.join(handoff, 'preflight.json'),
);
copy(path.join(runRoot, 'frontend-build.log'), path.join(handoff, 'frontend-build.log'));
copy(path.join(runRoot, 'electron-build.log'), path.join(handoff, 'electron-build.log'));
copy(
  path.join(runRoot, 'directory-build.log'),
  path.join(handoff, 'directory-build.log'),
);
copy(
  path.join(root, 'output/runtime/DS-016/ui016-20261031-1850/frontend-build.log'),
  path.join(handoff, 'raw-1.0.22-frontend-errors.log'),
);
copy(
  path.join(repo, '.tmp/logs/e2e-file.1793441713342-223516.log'),
  path.join(handoff, 'e2e-final-110.log'),
);
copy(
  path.join(repo, '.tmp/logs/e2e-file.1793443393275-229396.log'),
  path.join(handoff, 'e2e-post-build-5.log'),
);
copy(
  path.join(repo, '.tmp/logs/test-affected.1793441058215-230376.log'),
  path.join(handoff, 'test-affected.log'),
);
copy(
  path.join(repo, '.tmp/logs/lint-css-vars.1793441708230-210824.log'),
  path.join(handoff, 'lint-css-vars.log'),
);
copy(path.join(runRoot, 'actual-review.log'), path.join(handoff, 'actual-review.log'));

for (const name of screenshotNames) {
  copy(
    path.join(root, 'output/handoffs/DS-016/screenshots', name),
    path.join(handoff, 'screenshots', name),
  );
}

console.log(
  JSON.stringify(
    {
      baseline: baselineCheck.currentChanged,
      baselineMismatch: snapshotMismatch,
      sourceFiles: source.length,
      packageFiles: packageFiles.length,
      asarFrontend: asarFrontendFiles.length,
      asarMismatch: asarMismatch.length,
      distOnly: distOnly.length,
      screenshots: screenshotNames.length,
    },
    null,
    2,
  ),
);
