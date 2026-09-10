@echo off
setlocal
rem Local playtest launcher for the sealed 827 preview; no application is launched by development tools.
set "CRAFTMINE_DATA_DIR=C:\cm-playtest-827"
set "ELECTRON_RUN_AS_NODE="
set "CRAFTMINE_PLAYTEST_EXE=C:\cm-plan-next-20260910\desktop\build\releases\8276b4540289-84495c89-013c-4c2e-a67d-1d6b60c6b0e6\output\win-unpacked\Craftmine World.exe"
if not exist "%CRAFTMINE_PLAYTEST_EXE%" (
  echo The sealed 827 application was moved or is missing. See the playtest guide.
  pause
  exit /b 1
)
start "" "%CRAFTMINE_PLAYTEST_EXE%"
endlocal
