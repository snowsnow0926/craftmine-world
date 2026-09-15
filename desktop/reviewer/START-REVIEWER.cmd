@echo off
rem SPDX-License-Identifier: AGPL-3.0-only
setlocal DisableDelayedExpansion
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-REVIEWER.ps1"
if errorlevel 1 pause
