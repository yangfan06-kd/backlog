; Included by the compiler adapter after multiUser and before assisted UI.
; This beta uses one reviewed G: location, so it must not create the default
; LocalAppData\Programs folder or honor a persisted/command-line destination.
!macroundef setInstallModePerUser
!macro setInstallModePerUser
  StrCpy $installMode CurrentUser
  SetShellVarContext current
  StrCpy $INSTDIR "${PROJECT1_INSTALL_DIR}"
!macroend
