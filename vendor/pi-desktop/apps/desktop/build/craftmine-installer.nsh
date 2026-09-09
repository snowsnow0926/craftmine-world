!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\craftmine-upgrade-guard.ps1 "${BUILD_RESOURCES_DIR}\..\..\..\..\..\desktop\windows-upgrade-guard.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -File "$PLUGINSDIR\craftmine-upgrade-guard.ps1" -BuildId "${VERSION}"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "升级前备份未完成。请关闭 craftmine world 后重试。现有世界资料没有被修改。"
    Abort
  ${EndIf}
!macroend
