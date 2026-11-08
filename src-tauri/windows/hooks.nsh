; ReformANY Orbit context entry. No background services, no shell extension DLL.
; SHCTX follows the installer installation context (current user or machine).
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit" "MUIVerb" "ReformANY Orbit"
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit" "Icon" "$INSTDIR\ReformANY.exe,0"
  WriteRegStr SHCTX "Software\Classes\*\shell\ReformANYOrbit\command" "" '$\"$INSTDIR\ReformANY.exe$\" orbit $\"%1$\"'

  ; The same compact Orbit works for folders, including ZIP/7z creation.
  WriteRegStr SHCTX "Software\Classes\Directory\shell\ReformANYOrbit" "MUIVerb" "ReformANY Orbit"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\ReformANYOrbit" "Icon" "$INSTDIR\ReformANY.exe,0"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\ReformANYOrbit\command" "" '$\"$INSTDIR\ReformANY.exe$\" orbit $\"%1$\"'

  ; Notify the running Explorer shell that context commands have changed.
  ; This is a refresh, not an Explorer restart or background helper.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\ReformANYOrbit"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\ReformANYOrbit"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
