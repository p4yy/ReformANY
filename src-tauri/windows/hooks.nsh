; ReformANY Orbit context entry. No background services, no shell extension DLL.
; SHCTX follows the installer installation context (current user or machine).
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit" "MUIVerb" "ReformANY Orbit"
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit" "Icon" "$INSTDIR\ReformANY.exe,0"
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit\command" "" '$\"$INSTDIR\ReformANY.exe$\" orbit $\"%1$\"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\ReformANYOrbit"
!macroend
