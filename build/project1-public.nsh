!include LogicLib.nsh
!include FileFunc.nsh
!undef INSTALL_MODE_PER_ALL_USERS_REQUIRED
!ifndef INSTALL_MODE_PER_ALL_USERS_REQUIRED
  Var perMachineInstallationFolder
  !macro setInstallModePerAllUsers
  !macroend
!endif
Var /GLOBAL project1UnsafeReparse
Var /GLOBAL publicWalkPath
Var /GLOBAL publicWalkParent

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    InstallDir "G:\project1\.tmp\DS-020\public-stub"
  !else
    InstallDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  !endif
!macroend
!macro preInit
  !ifdef BUILD_UNINSTALLER
    StrCpy $INSTDIR "G:\project1\.tmp\DS-020\public-stub"
  !endif
!macroend
!macro customInit
  ${If} $hasPerMachineInstallation == "1"
    MessageBox MB_OK|MB_ICONSTOP "请使用当前用户安装，保留已有数据后再处理其他安装方式。"
    Quit
  ${EndIf}
!macroend

; Prefix is empty in the installer and un. in the uninstaller. Check before
; any recursive deletion; data lives in an adjacent directory, never INSTDIR.
!macro publicValidatePaths PREFIX REQUIRED
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${GetFileName} "$INSTDIR" $R0
  ${If} $R0 != "${APP_FILENAME}"
    MessageBox MB_OK|MB_ICONSTOP "请使用名称为 ${APP_FILENAME} 的专用程序文件夹。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $project1UnsafeReparse "0"
  StrCpy $publicWalkPath "$INSTDIR"
  public_parent_loop_${PREFIX}:
    Push $publicWalkPath
    Call ${PREFIX}project1CheckReparsePath
    Pop $R0
    ${GetParent} "$publicWalkPath" $publicWalkParent
    StrCmp $publicWalkParent "" public_parent_done_${PREFIX}
    StrCmp $publicWalkParent $publicWalkPath public_parent_done_${PREFIX}
    StrCpy $publicWalkPath $publicWalkParent
    Goto public_parent_loop_${PREFIX}
  public_parent_done_${PREFIX}:
  ${If} $project1UnsafeReparse == "1"
    MessageBox MB_OK|MB_ICONSTOP "程序路径包含目录链接或无法安全读取，已停止。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  IfFileExists "$INSTDIR\resources\project1-distribution.json" public_owned_${PREFIX}
  !if ${REQUIRED} == 1
    MessageBox MB_OK|MB_ICONSTOP "未找到本软件的安装标记，已停止卸载。" /SD IDOK
    SetErrorLevel 2
    Quit
  !else
    FindFirst $R1 $R2 "$INSTDIR\*"
    public_contents_${PREFIX}:
      StrCmp $R2 "" public_empty_${PREFIX}
      StrCmp $R2 "." public_next_${PREFIX}
      StrCmp $R2 ".." public_next_${PREFIX}
      FindClose $R1
      MessageBox MB_OK|MB_ICONSTOP "该文件夹已有其他内容，请选择空的专用文件夹。" /SD IDOK
      SetErrorLevel 2
      Quit
    public_next_${PREFIX}:
      FindNext $R1 $R2
      Goto public_contents_${PREFIX}
    public_empty_${PREFIX}:
      FindClose $R1
      Goto public_done_${PREFIX}
  !endif
  public_owned_${PREFIX}:
    Push "$INSTDIR"
    Call ${PREFIX}project1CheckTree
    Pop $R0
    ${If} $project1UnsafeReparse == "1"
      MessageBox MB_OK|MB_ICONSTOP "程序文件夹含目录链接或无法安全读取，已停止。" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  Goto public_done_${PREFIX}
  public_done_${PREFIX}:
!macroend

!macro customCheckAppRunning
  !include "${PROJECT_DIR}\build\project1-installer-copy.nsh"
  !ifdef BUILD_UNINSTALLER
    !insertmacro publicValidatePaths "un." 1
  !else
    !insertmacro publicValidatePaths "" 0
  !endif
  public_running:
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先保存并关闭项目进展，再重试安装。" /SD IDCANCEL IDRETRY public_running
      Quit
    ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER
Function un.project1CheckReparsePath
  Exch $R0
  Push $R1
  Push $R2
  System::Call 'kernel32::GetFileAttributesW(w "$R0")i.s ?e'
  Pop $R2
  Pop $R1
  StrCmp $R1 -1 0 project1_path_attributes
  StrCmp $R2 2 project1_path_done
  StrCmp $R2 3 project1_path_done
  StrCpy $project1UnsafeReparse "1"
  Goto project1_path_done
  project1_path_attributes:
  IntOp $R2 $R1 & 0x400
  IntCmp $R2 0 project1_path_done
    StrCpy $project1UnsafeReparse "1"
  project1_path_done:
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function un.project1CheckTree
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  ${If} $project1UnsafeReparse == "1"
    Goto project1_tree_done
  ${EndIf}
  ClearErrors
  FindFirst $R1 $R2 "$R0\*.*"
  IfErrors project1_tree_failed
  project1_tree_loop:
    StrCmp $R2 "" project1_tree_done
    StrCmp $R2 "." project1_tree_next
    StrCmp $R2 ".." project1_tree_next
    System::Call 'kernel32::GetFileAttributesW(w "$R0\$R2")i.s'
    Pop $R3
    StrCmp $R3 -1 project1_tree_failed
    IntOp $R4 $R3 & 0x400
    IntCmp $R4 0 project1_tree_not_reparse
      StrCpy $project1UnsafeReparse "1"
      Goto project1_tree_done
    project1_tree_not_reparse:
    IfFileExists "$R0\$R2\*.*" project1_tree_is_dir project1_tree_next
    project1_tree_is_dir:
      Push "$R0\$R2"
      Call un.project1CheckTree
      ; The callee already restored the parent $R0; discard its stack argument.
      Pop $R4
    project1_tree_next:
      FindNext $R1 $R2
      Goto project1_tree_loop
  project1_tree_failed:
    StrCpy $project1UnsafeReparse "1"
  project1_tree_done:
    FindClose $R1
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd


!macro customUnInit
  ; The compiler adapter validates before the upstream first SetOutPath.
!macroend
!macro customUnInstall
  !insertmacro publicValidatePaths "un." 1
!macroend
!endif
