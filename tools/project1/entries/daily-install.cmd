@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-launcher.ps1" -Mode Install
if errorlevel 1 pause
