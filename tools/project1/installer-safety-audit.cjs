const fs = require('node:fs');
const path = require('node:path');

const root = 'G:/project1';
const oldRelease = path.join(root, 'output/releases/DS-011/20261028-213655');
const aRelease = process.argv[2];
const bRelease = process.argv[3];
if (!aRelease || !bRelease) throw new Error('usage: installer-safety-audit.cjs <A> <B>');
const read = (file) => fs.readFileSync(file, 'utf8');
const oldScript = read(path.join(oldRelease, 'compiler-input.nsi'));
const aScript = read(path.join(aRelease, 'compiler-input.nsi'));
const bScript = read(path.join(bRelease, 'compiler-input.nsi'));
const custom = read(
  path.join(root, 'repos/project1-desktop/build/project1-installer.nsh'),
);
const copyInclude = read(
  path.join(root, 'repos/project1-desktop/build/project1-installer-copy.nsh'),
);
const oldCustom = read(path.join(oldRelease, 'project1-installer.nsh'));
const config = read(
  path.join(root, 'repos/project1-desktop/build/electron-builder.project1-installer.cjs'),
);
const oldManifest = JSON.parse(read(path.join(oldRelease, 'build-manifest.json')));
const aManifest = JSON.parse(read(path.join(aRelease, 'build-manifest.json')));
const bManifest = JSON.parse(read(path.join(bRelease, 'build-manifest.json')));
const installSection = read(
  path.join(
    root,
    'repos/project1-desktop/node_modules/app-builder-lib/templates/nsis/installSection.nsh',
  ),
);
const uninstaller = read(
  path.join(
    root,
    'repos/project1-desktop/node_modules/app-builder-lib/templates/nsis/uninstaller.nsh',
  ),
);
const policyA = JSON.parse(
  read(path.join(aRelease, 'win-unpacked/resources/project1-runtime.json')),
);
const policyB = JSON.parse(
  read(path.join(bRelease, 'win-unpacked/resources/project1-runtime.json')),
);
const testProfile = path.join(root, 'output/runtime/DS-012/case-20261029-a/profile');
const oldHas = (text) => text.includes('--delete-app-data');
const oldGuard =
  oldCustom.includes('customUnInit') || oldCustom.includes('customUnInstall');
const audit = {
  checkedAt: new Date().toISOString(),
  scope: 'A-stage static/template and artifact audit; no Setup/Uninstall executed',
  oldBaseline: {
    release: oldRelease,
    uninstallerDeleteDataBranchPresent: oldHas(oldScript) || oldHas(uninstaller),
    recursiveRemovePresent:
      oldScript.includes('RMDir /r') || uninstaller.includes('RMDir /r'),
    customUninstallGuardPresent: oldGuard,
    risk:
      !oldGuard && oldHas(uninstaller) && uninstaller.includes('RMDir /r')
        ? 'reachable old uninstaller branch had no project guard; not executed'
        : 'no recorded reachable gap',
  },
  candidates: {
    A: aManifest,
    B: bManifest,
    sameBusinessSource:
      JSON.stringify(aManifest.sourceChanges) === JSON.stringify(bManifest.sourceChanges),
    policyA,
    policyB,
    policyInsideTaskRuntime:
      path
        .resolve(policyA.profileRoot)
        .startsWith(path.resolve(root, 'output/runtime/DS-012') + path.sep) &&
      path
        .resolve(policyB.profileRoot)
        .startsWith(path.resolve(root, 'output/runtime/DS-012') + path.sep),
    defaultProfileReferenced: [policyA, policyB].some(
      (p) =>
        path.resolve(p.profileRoot) ===
        path.resolve(root, 'output/runtime/project1-preview'),
    ),
  },
  guards: {
    fixedProgramDir: custom.includes('PROJECT1_INSTALL_DIR'),
    rejectDeleteAppData:
      custom.includes('--delete-app-data') && custom.includes('customUnInit'),
    rejectAllUsers: custom.includes('/allusers'),
    rejectAllUsersAtInstall: custom.includes('$installMode == "all"'),
    recursiveReparseCheck: custom.includes('project1CheckTree'),
    reparseAncestors: custom.includes('project1CheckReparsePath'),
    pinUninstallPath: custom.includes('customUnInstall'),
    copyUpdaterCacheSuppressed:
      copyInclude.includes('copyFile') &&
      copyInclude.includes('APP_INSTALLER_STORE_FILE'),
    buildUninstallerStubOnly:
      aScript.includes('BUILD_UNINSTALLER') || aManifest.stubEntries.length === 0,
    upstreamOldUninstallerBeforeExtraction:
      installSection.indexOf('uninstallOldVersion') >= 0 &&
      installSection.indexOf('uninstallOldVersion') <
        installSection.indexOf('installApplicationFiles'),
    upstreamEarlyUnInitSetOutPath:
      uninstaller.indexOf('Function un.onInit') >= 0 &&
      uninstaller.indexOf('SetOutPath $INSTDIR') >= 0,
    actualInstallRun: false,
    actualUninstallRun: false,
  },
  compilerInputs: {
    A: path.join(aRelease, 'compiler-input.nsi'),
    B: path.join(bRelease, 'compiler-input.nsi'),
    AReferencesCustomInclude:
      aScript.includes('project1-installer.nsh') && custom.includes('customUnInit'),
    BReferencesCustomInclude:
      bScript.includes('project1-installer.nsh') && custom.includes('customUnInit'),
    AGeneratedStubEntries: aManifest.stubEntries,
    BGeneratedStubEntries: bManifest.stubEntries,
    installedAppExists: fs.existsSync(
      path.join(root, 'output/installed/project1-preview/app'),
    ),
  },
  testProfile,
  assertions: [
    'Old DS-011 input contains the upstream data-deletion and recursive-remove branches without the new project guard; this is retained as a static before/after counterexample, not executed.',
    'A/B generated inputs include customUnInit/customUnInstall; the uninstaller rejects --delete-app-data and /allusers and checks reparse points before recursive removal.',
    'A/B payload policy is under output/runtime/DS-012 and does not reference the default profile.',
    'The candidate build only ran the reviewed BUILD_UNINSTALLER generator; no actual Setup/Uninstall was executed.',
  ],
};

const allGuards = [
  audit.guards.fixedProgramDir,
  audit.guards.rejectDeleteAppData,
  audit.guards.rejectAllUsers,
  audit.guards.rejectAllUsersAtInstall,
  audit.guards.recursiveReparseCheck,
  audit.guards.reparseAncestors,
  audit.guards.pinUninstallPath,
  audit.guards.copyUpdaterCacheSuppressed,
  audit.candidates.policyInsideTaskRuntime,
  !audit.candidates.defaultProfileReferenced,
  !audit.compilerInputs.installedAppExists,
];
audit.staticPresencePass = allGuards.every(Boolean);
audit.runtimeSafetyProven = false;
const out = path.join(root, `output/runtime/DS-012/safety-audit-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
if (!audit.staticPresencePass) process.exitCode = 1;
