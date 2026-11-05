; Expanded only after installUtil.nsh has defined copyFile. Keep its normal
; behavior, but omit the unused updater installer cache. This application has
; no auto-updater and must not copy the setup into LocalAppData.
!ifmacrodef copyFile
  !macroundef copyFile
  !macro copyFile FROM TO
    !if `${TO}` != `$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}`
      ${StdUtils.GetParentPath} $R5 `${TO}`
      CreateDirectory `$R5`
      ClearErrors
      CopyFiles /SILENT `${FROM}` `${TO}`
    !endif
  !macroend
!endif
