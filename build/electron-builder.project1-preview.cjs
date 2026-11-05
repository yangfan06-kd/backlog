'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..');
const builderOutput = path.join(root, '.tmp', 'project1-preview-build');

/**
 * Deliberately separate from the upstream release configuration. This builds
 * only a Windows x64 unpacked directory, never NSIS/portable/multi-arch output,
 * and keeps the upstream package/dependency identity untouched.
 */
module.exports = {
  appId: 'local.project1.preview',
  productName: '项目进展（内测版）',
  artifactName: 'Project1Preview-${version}-${arch}.${ext}',
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
  extraMetadata: {
    name: 'project1-preview',
    version: process.env.PROJECT1_PREVIEW_VERSION || '1.0.0-preview.20261027',
    productName: '项目进展（内测版）',
    project1Preview: true,
  },
  electronDist: path.join(root, 'node_modules', 'electron', 'dist'),
  npmRebuild: false,
  asar: true,
  compression: 'normal',
  win: {
    target: ['dir'],
    executableName: 'Project1Preview',
    signExecutable: false,
    signAndEditExecutable: true,
    forceCodeSigning: false,
    requestedExecutionLevel: 'asInvoker',
  },
};
