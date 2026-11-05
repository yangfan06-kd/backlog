// Compiler adapter and observer for the pinned builder version. This never runs
// Setup/Uninstall: retain complete inputs, then call the original compiler
// (including the reviewed BUILD_UNINSTALLER generator).
const fs = require('node:fs');
const path = require('node:path');
// Initialize the public entry point before private target modules; loading the
// target first creates a circular PlatformPackager initialization.
require('app-builder-lib');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const {
  nsisEscapeString,
} = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
if (require('app-builder-lib/package.json').version !== '26.16.1')
  throw new Error('Recheck NSIS observer for the installed builder version');
const original = NsisTarget.prototype.executeMakensis;
const originalFinalScript = NsisTarget.prototype.computeFinalScript;
NsisTarget.prototype.computeFinalScript = function (script, ...rest) {
  const anchor = '!include "multiUser.nsh"';
  if (script.split(anchor).length !== 2)
    throw new Error('Unexpected upstream multi-user include');
  let adapted = script.replace(
    anchor,
    `${anchor}\n!include "${path.join(this.packager.projectDir, 'build/project1-install-mode.nsh')}"`,
  );
  const include = fs.readFileSync(
    path.join(this.packager.projectDir, 'build/project1-installer.nsh'),
    'utf8',
  );
  const first = include.indexOf('Function un.project1CheckReparsePath');
  const last = include.indexOf('!macro customUnInit', first);
  if (first < 0 || last < first) throw new Error('Unexpected path guard layout');
  const functions = include.slice(first, last).replaceAll('un.project1', 'project1');
  const init = 'Function .onInit';
  if (adapted.split(init).length !== 2) throw new Error('Unexpected installer init');
  adapted = adapted.replace(
    init,
    `!ifndef BUILD_UNINSTALLER\n${functions}\n!endif\n${init}\n!ifndef BUILD_UNINSTALLER\n!insertmacro project1ValidatePaths ""\nStrCpy $INSTDIR "G:\\project1\\.tmp\\project1-installer-init"\n!endif`,
  );
  const uninstallerInclude = '!include "uninstaller.nsh"';
  if (adapted.split(uninstallerInclude).length !== 2)
    throw new Error('Unexpected uninstaller include');
  let uninstaller = fs.readFileSync(
    path.join(
      path.dirname(require.resolve('app-builder-lib/package.json')),
      'templates/nsis/uninstaller.nsh',
    ),
    'utf8',
  );
  const unInit = 'Function un.onInit';
  if (uninstaller.split(unInit).length !== 2)
    throw new Error('Unexpected uninstaller init');
  uninstaller = uninstaller.replace(
    unInit,
    `${unInit}\n!insertmacro project1ValidatePaths "un."\nStrCpy $INSTDIR "G:\\project1\\output\\installed\\project1-preview\\app"`,
  );
  adapted = adapted.replace(uninstallerInclude, uninstaller);
  return originalFinalScript.call(this, adapted, ...rest);
};
NsisTarget.prototype.executeMakensis = async function (
  defines,
  commands,
  script,
  options,
) {
  const dir = process.env.PROJECT1_NSIS_AUDIT_DIR;
  if (!dir || !path.resolve(dir).startsWith(path.resolve('G:/project1') + path.sep))
    throw new Error('Project-local compiler audit directory required');
  fs.mkdirSync(dir, { recursive: true });
  const phase = Object.hasOwn(defines, 'BUILD_UNINSTALLER') ? 'generator' : 'installer';
  const requestedOutFile =
    typeof commands.OutFile === 'string'
      ? commands.OutFile.replace(/^"|"$/g, '')
      : null;
  if (!requestedOutFile || !path.isAbsolute(requestedOutFile))
    throw new Error('Installer OutFile must be an absolute path');
  let stagedOutFile = null;
  let staging = null;
  if (phase === 'installer') {
    // Electron-builder's generator writes its 181KB stub to the same OutFile
    // that the real installer must later replace; it also executes that stub to
    // extract the uninstaller. Keep the real installer off that path until the
    // generator stub is finished, then replace it atomically in the same dir.
    stagedOutFile = path.join(
      path.dirname(requestedOutFile),
      `.project1-final-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.exe`,
    );
    commands.OutFile = `"${stagedOutFile}"`;
    staging = {
      reason: 'avoid reusing the executed BUILD_UNINSTALLER stub OutFile',
      requestedOutFile,
      stagedOutFile,
    };
  }
  const args = ['-INPUTCHARSET', 'UTF8'];
  for (const [key, value] of Object.entries(defines))
    args.push(value == null ? `-D${key}` : `-D${key}=${nsisEscapeString(String(value))}`);
  for (const [key, value] of Object.entries(commands))
    for (const item of Array.isArray(value) ? value : [value])
      args.push(`-X${key} ${item}`);
  args.push('-');
  const compiler = await getMakeNsisPath(
    this.packager.config.toolsets?.nsis,
    this.options.customNsisBinary,
  );
  if (phase === 'installer') {
    if (!defines.UNINSTALLER_OUT_FILE || !fs.existsSync(defines.UNINSTALLER_OUT_FILE))
      throw new Error('Missing generated uninstaller for artifact binding');
    fs.copyFileSync(defines.UNINSTALLER_OUT_FILE, path.join(dir, 'reviewed-uninstaller.exe'));
  }
  fs.writeFileSync(path.join(dir, `${phase}-input.nsi`), script);
  fs.cpSync(
    path.join(
      path.dirname(require.resolve('app-builder-lib/package.json')),
      'templates/nsis',
    ),
    path.join(dir, 'upstream-templates'),
    { recursive: true },
  );
  const includes = [];
  for (const match of script.matchAll(/!include\s+"([^"]+)"/g)) {
    if (!path.isAbsolute(match[1]) || !fs.existsSync(match[1])) continue;
    const copy = `${phase}-${includes.length}-${path.basename(match[1])}`;
    fs.copyFileSync(match[1], path.join(dir, copy));
    includes.push({ original: match[1], copy });
  }
  const optionsRecord = {
    compiler: compiler.path,
    args,
    defines,
    commands,
    includes,
    requestedOutFile,
    staging,
  };
  fs.writeFileSync(
    path.join(dir, `${phase}-options.json`),
    JSON.stringify(optionsRecord, null, 2),
  );
  const result = await original.call(this, defines, commands, script, options);
  if (stagedOutFile) {
    if (!fs.existsSync(stagedOutFile))
      throw new Error(`Staged installer output missing: ${stagedOutFile}`);
    const stagedBytes = fs.statSync(stagedOutFile).size;
    if (stagedBytes <= 0) throw new Error('Staged installer output is empty');
    let replaced = false;
    let lastError = null;
    // The generator stub was executed from requestedOutFile. Wait for that
    // process/file handle to finish, then replace the stub with the real
    // installer. This is bounded and never kills an unrelated process.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (fs.existsSync(requestedOutFile)) fs.rmSync(requestedOutFile, { force: true });
        fs.renameSync(stagedOutFile, requestedOutFile);
        replaced = true;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!replaced) {
      throw new Error(
        `Could not replace generator stub output after final compile: ${lastError || 'unknown'}`,
      );
    }
    const finalBytes = fs.statSync(requestedOutFile).size;
    if (finalBytes !== stagedBytes)
      throw new Error('Final installer size does not match staged compiler output');
    commands.OutFile = `"${requestedOutFile}"`;
    fs.writeFileSync(
      path.join(dir, `${phase}-output-binding.json`),
      JSON.stringify(
        {
          requestedOutFile,
          stagedOutFile,
          stagedBytes,
          finalBytes,
          replaced,
          note: 'Final compiler output replaced the BUILD_UNINSTALLER stub only after a successful compile.',
        },
        null,
        2,
      ),
    );
  }
  return result;
};
