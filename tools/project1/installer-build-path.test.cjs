'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertInstallerBuilderOutput } = require('./build-installer.cjs');
test('only explicit DS-017 disposable build locations are accepted', () => {
  for (const name of ['validation-build', 'daily-build-main-20261031'])
    assert.doesNotThrow(() => assertInstallerBuilderOutput(`G:/project1/output/runtime/DS-017/${name}/builder-output`, 'DS-017'));
});
test('profile paths, task roots and unrelated directories are rejected without deletion', () => {
  for (const value of [
    'G:/project1/output/runtime/project1-preview',
    'G:/project1/output/runtime/DS-017/validation/profile',
    'G:/project1/output/runtime/DS-017',
    'G:/project1/output/runtime',
    'G:/project1/output/runtime/DS-017/validation-build/builder-output/../..',
    'G:/project1/output/releases/DS-017/validation-build/builder-output',
    'C:/Users/Public/validation-build/builder-output',
  ]) assert.throws(() => assertInstallerBuilderOutput(value, 'DS-017'), /build override/);
});
test('another task cannot opt into the DS-017 output override', () => {
  assert.throws(() => assertInstallerBuilderOutput('G:/project1/output/runtime/DS-017/validation-build/builder-output', 'DS-099'), /build override/);
});
test('DS-018 only accepts its own disposable build directory, never a profile', () => {
  assert.doesNotThrow(() => assertInstallerBuilderOutput('G:/project1/output/runtime/DS-018/daily-build-reviewed/builder-output', 'DS-018'));
  for (const target of ['G:/project1/output/runtime/project1-preview', 'G:/project1/output/runtime/DS-018/validation/profile', 'G:/project1/output/runtime/DS-017/daily-build-reviewed/builder-output']) assert.throws(() => assertInstallerBuilderOutput(target, 'DS-018'), /build override/);
});
test('DS-019 build output stays separate from profiles and other tasks', () => {
  assert.doesNotThrow(() => assertInstallerBuilderOutput('G:/project1/output/runtime/DS-019/daily-build-final/builder-output', 'DS-019'));
  for(const target of ['G:/project1/output/runtime/DS-019/validation/profile','G:/project1/output/runtime/project1-preview','G:/project1/output/runtime/DS-018/daily-build-final/builder-output']) assert.throws(() => assertInstallerBuilderOutput(target, 'DS-019'), /build override/);
});
