# Project Progress / 项目进展

A local-first Windows desktop app for personal projects, daily progress notes, routines, memos and a four-quadrant overview. This repository is the source edition of the **0.1.0-beta.19** Windows x64 trial build.

## Download

- Latest Windows x64 trial package: see the **Releases** page.
- The release ZIP contains the NSIS setup, installation notes, version information, SHA-256 checksums and open-source notices.
- The package is unsigned. Windows may show an unknown publisher warning.
- This is a trial build for Windows x64. Keep a complete backup before upgrading in place.

## What is in this edition

- Four-quadrant project overview and future planning dates
- Project progress with ordered steps, completion history and backfill
- Routines with an editable history table
- Memos with optional reminders
- Per-project archive, recoverable trash and local automatic backups
- Local-first storage; no account or cloud service is required
- Simplified light and dark themes

## Install and update

1. Download and unzip the Windows x64 release package.
2. Run `ProjectProgress-Setup-<version>-x64.exe`.
3. The default program directory is `%LOCALAPPDATA%\Programs\ProjectProgress`; user data is kept in the sibling `ProjectProgress-data` directory.
4. To upgrade, export a complete backup, close the app, run a newer setup over the same installation directory, and verify the version and data.
5. Uninstalling removes the program but keeps the adjacent data directory.

## Build from source

Prerequisites: Node.js, npm and the repository's Electron dependencies on Windows.

```powershell
npm ci
npm run buildFrontend:prod:es6
npm run electron:build
node tools/project1/build-public.cjs 0.1.0-beta.19
node tools/project1/prepare-delivery.cjs 0.1.0-beta.19
```

The build scripts are project-specific and expect the project checkout layout used by this edition. Generated outputs and installation media are intentionally not committed.

## Project origin and license

This edition is a limited fork and integration built on top of [Super Productivity](https://github.com/super-productivity/super-productivity), which is distributed under the MIT license. The upstream copyright and license notices are retained in `LICENSE` and in the generated third-party notices.

The additional project-specific code in this repository is provided under the same MIT license unless a file states otherwise. See `LICENSE`, `THIRD-PARTY-NOTICES.txt` in the release package, and the upstream project for attribution.

## Status and limitations

- Windows x64 trial edition; other platforms and ARM64 are not covered by this trial.
- No cloud account, cross-device sync, mobile client or signed installer in this edition.
- Do not use a trial build as the only copy of important data.
- The release page is the canonical place for downloadable builds; source snapshots are provided for transparency and reproducibility.
