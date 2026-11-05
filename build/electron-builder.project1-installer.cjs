'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtimePolicyFile =
  process.env.PROJECT1_INSTALLER_POLICY_FILE ||
  path.join(root, 'build', 'project1-runtime-installer.json');
const builderOutput = process.env.PROJECT1_INSTALLER_BUILD_DIR
  ? path.resolve(process.env.PROJECT1_INSTALLER_BUILD_DIR)
  : path.join(root, '.tmp', 'project1-installer-build');
if (process.env.PROJECT1_INSTALLER_BUILD_DIR)
  require('../tools/project1/build-installer.cjs').assertInstallerBuilderOutput(builderOutput);

/**
 * Separate installer candidate configuration. The existing project1-preview
 * dir config remains unchanged. This config is Windows x64 NSIS only, unsigned,
 * current-user, assisted, no elevation helper, a desktop shortcut, no auto-run and
 * no app-data deletion. The runtime policy is shipped next to app.asar.
 */
module.exports = {
  appId: 'local.project1.preview',
  productName: '项目进展（内测版）',
  artifactName: 'Project1Preview-Setup-${version}-${arch}.${ext}',
  directories: {
    output: builderOutput,
    buildResources: path.join(root, 'build'),
  },
  files: [
    'electron/**/*',
    '!electron/**/*.ts',
    '!electron/**/*.test.cjs',
    '!electron/**/*.js.map',
    '.tmp/angular-dist/browser/**/*',
    '!**/*.map',
    'LICENSE',
    'README.md',
  ],
  extraResources: [
    {
      from: runtimePolicyFile,
      to: 'project1-runtime.json',
    },
  ],
  extraMetadata: {
    name: 'project1-preview',
    version: process.env.PROJECT1_INSTALLER_VERSION || '1.0.0-preview.20261028',
    productName: '项目进展（内测版）',
    project1Preview: true,
  },
  electronDist: path.join(root, 'node_modules', 'electron', 'dist'),
  npmRebuild: false,
  asar: true,
  compression: 'normal',
  win: {
    target: ['nsis'],
    executableName: 'Project1Preview',
    signExecutable: false,
    signAndEditExecutable: true,
    forceCodeSigning: false,
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: false,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    packElevateHelper: false,
    warningsAsErrors: true,
    include: path.join(root, 'build', 'project1-installer.nsh'),
    artifactName: 'Project1Preview-Setup-${version}-${arch}.${ext}',
    language: '2052',
    installerLanguages: ['zh_CN'],
    multiLanguageInstaller: true,
    uninstallDisplayName: '项目进展（内测版）',
    shortcutName: '项目进展（内测版）',
  },
};
