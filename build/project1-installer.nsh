; Project1 installer policy. This file is included before the upstream assisted
!include LogicLib.nsh
; installer script. It keeps the current-machine prototype at one controlled
; program directory and never writes a profile under the program tree.

; electron-builder forces per-machine mode for every assisted installer. Undo
; that one define so the generated script stays current-user and no elevation
; helper is used. The install-mode page still appears, but All Users is disabled
; because MULTIUSER_INSTALLMODE_ALLOW_ELEVATION is intentionally absent.
!undef INSTALL_MODE_PER_ALL_USERS_REQUIRED

; Upstream multiUserUi.nsh still references this macro in a shared function even
; when the per-machine mode is not compiled. The current-user candidate never
; takes that runtime path, so a compile-only compatibility macro is enough.
!ifndef INSTALL_MODE_PER_ALL_USERS_REQUIRED
  Var perMachineInstallationFolder
  !macro setInstallModePerAllUsers
    ; Per-machine installation is intentionally not available in this candidate.
  !macroend
!endif

!define PROJECT1_INSTALL_DIR "G:\project1\output\installed\project1-preview\app"
!define PROJECT1_STUB_WORKDIR "G:\project1\.tmp\project1-installer-stub"

; The upstream .onInit calls SetOutPath before preInit. Set the initial
; directory at compile time too, so the generator stub cannot select a host
; default directory before our runtime hook executes.
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    InstallDir "${PROJECT1_STUB_WORKDIR}"
  !else
    InstallDir "G:\project1\.tmp\project1-installer-init"
  !endif
!macroend

!macro preInit
  !ifdef BUILD_UNINSTALLER
    StrCpy $INSTDIR "${PROJECT1_STUB_WORKDIR}"
  !else
    StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
  !endif
!macroend

!macro customInit
  ; initMultiUser may have selected the default current-user folder; pin the
  ; reviewed program directory before any real installation page runs.
  StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
  ${If} $hasPerMachineInstallation == "1"
    MessageBox MB_OK|MB_ICONSTOP "检测到所有用户安装登记。请取消并先核对该安装，本候选不会请求管理员权限。"
    Quit
  ${EndIf}
  ${If} $INSTDIR != "${PROJECT1_INSTALL_DIR}"
    MessageBox MB_OK|MB_ICONSTOP "安装目录被限制为项目内已审查的程序目录。"
    Quit
  ${EndIf}
!macroend

; The install-mode page can reset the current-user default. The install-section
; hook below runs after that page and before uninstall/extraction SetOutPath.
!macro customCheckAppRunning
  !include "${PROJECT_DIR}\build\project1-installer-copy.nsh"
  !ifdef BUILD_UNINSTALLER
    !insertmacro project1ValidatePaths "un."
  !else
    !insertmacro project1ValidatePaths ""
  !endif
  StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
  ${If} $installMode == "all"
    MessageBox MB_OK|MB_ICONSTOP "本候选只允许当前用户安装，不能选择所有用户。"
    Quit
  ${EndIf}
  project1_check_running:
  nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  ${If} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "项目进展正在运行。请先在应用中保存并正常关闭，再点“重试”；取消不会删除本机数据。" \
      /SD IDCANCEL IDRETRY project1_check_running
    Quit
  ${EndIf}
!macroend

; Replace the upstream English uninstallFailed message with a precise Chinese
; message. We do not claim that a file lock is definitely the cause; the raw
; uninstaller exit code remains in the message and no data is auto-deleted.
!macro customUnInstallCheck
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法启动旧版本卸载程序，安装已停止。请保留现状并重试。"
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "旧版本卸载未成功。程序文件可能被占用，请关闭相关程序后重新运行安装程序重试；仍失败请保留现状。错误码：$R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

; ---- Uninstall safety -------------------------------------------------------
; The upstream uninstaller trusts the registry InstallLocation before our hooks
; and later executes RMDir /r $INSTDIR. Pin our one reviewed directory, reject
; data-deletion/all-users arguments, and refuse a reparse point anywhere in the
; tree or its ancestors before any uninstall deletion runs.

Var /GLOBAL project1UnsafeReparse

; Invoked before the first SetOutPath/initMultiUser, and again immediately
; before file mutation. The compiler adapter supplies both function namespaces.
!macro project1ValidatePaths PREFIX
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${GetOptions} $R0 "/allusers" $R1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadRegStr $R1 HKLM32 "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 HKLM64 "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R1 != ""
  ${OrIf} $R2 != ""
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $project1UnsafeReparse "0"
  Push "G:\project1"
  Call ${PREFIX}project1CheckReparsePath
  Pop $R0
  Push "G:\project1\output"
  Call ${PREFIX}project1CheckReparsePath
  Pop $R0
  Push "G:\project1\output\installed"
  Call ${PREFIX}project1CheckReparsePath
  Pop $R0
  Push "G:\project1\output\installed\project1-preview"
  Call ${PREFIX}project1CheckReparsePath
  Pop $R0
  Push "${PROJECT1_INSTALL_DIR}"
  Call ${PREFIX}project1CheckReparsePath
  Pop $R0
  IfFileExists "${PROJECT1_INSTALL_DIR}\*.*" 0 +4
    Push "${PROJECT1_INSTALL_DIR}"
    Call ${PREFIX}project1CheckTree
    Pop $R0
  ${If} $project1UnsafeReparse == "1"
    MessageBox MB_OK|MB_ICONSTOP "程序路径无法安全访问或含目录链接，已取消；请核对安装目录。" /SD IDOK
    SetErrorLevel 2
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
  !insertmacro project1ValidatePaths "un."
  StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
!macroend

!macro customUnInstall
  !insertmacro project1ValidatePaths "un."
  StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
  StrCpy $project1UnsafeReparse "0"
  Push "${PROJECT1_INSTALL_DIR}"
  Call un.project1CheckTree
  Pop $R0
  ${If} $project1UnsafeReparse == "1"
    MessageBox MB_OK|MB_ICONSTOP "程序目录内发现 reparse point，已拒绝递归删除；请人工核对。"
    Abort
  ${EndIf}
!macroend

!endif
