; Krya's own part of the installer (electron-builder's NSIS templates include it).
;
; Install: the login item is Electron's, a value named after the app's id
; (com.ikstro.2talker) under HKCU's Run key, pointing at the program. Krya was
; Altype until 0.11 and its program was Altype.exe: an update over it keeps the
; install folder (the registry's InstallLocation) but brings Krya.exe, so a
; login item already there is pointed at it now, before Krya first starts and
; sets it itself. No login item, nothing written.
;
; Uninstall asks once whether the data goes too: the settings, the words, the
; dictionaries, the translator's models and the voice (%APPDATA%\Krya and
; the folders of the app's earlier names), the speech engine with its models
; (%LOCALAPPDATA%\Krya, and Altype's) and the transcripts (Documents\Krya,
; and Altype's). No keeps everything for a later install; an update never asks
; and never deletes. Notes in the person's knowledge base are theirs and are
; never touched.

!macro customInstall
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ikstro.2talker"
  ${if} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ikstro.2talker" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      SetShellVarContext current
      StrCpy $0 "keep"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Delete Krya's data too?$\r$\n$\r$\nYes removes the settings, the saved words, the dictionaries, the translator and the voice, the speech engine with its models, and the transcripts in Documents\Krya.$\r$\n$\r$\nNo keeps all of it for a later install. Notes in your knowledge base stay either way." \
        IDNO +2
      StrCpy $0 "delete"
      ${if} $0 == "delete"
        RMDir /r "$APPDATA\Krya"
        RMDir /r "$APPDATA\Altype"
        RMDir /r "$APPDATA\2Talker"
        RMDir /r "$APPDATA\tu-talk"
        RMDir /r "$LOCALAPPDATA\Krya"
        RMDir /r "$LOCALAPPDATA\Altype"
        RMDir /r "$DOCUMENTS\Krya"
        RMDir /r "$DOCUMENTS\Altype"
      ${endif}
    ${endIf}
  ${endIf}
!macroend
