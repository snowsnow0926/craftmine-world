@echo off
setlocal
for /f "tokens=1 delims==" %%V in ('set CRAFTMINE_ 2^>nul') do set "%%V="
for /f "tokens=1 delims==" %%V in ('set PI_DESKTOP_ 2^>nul') do set "%%V="
set "CRAFTMINE_DATA_DIR=%LOCALAPPDATA%\CraftmineWorld-FirstCreationPreview23"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
start "" "%~dp0..\output\win-unpacked\Craftmine World.exe"
