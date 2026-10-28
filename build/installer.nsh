; Altype's own part of the installer (electron-builder's NSIS templates include it).
;
; Uninstall asks once whether the data goes too: the settings, the words, the
; dictionaries, the translator's models and the voice (%APPDATA%\Altype and
; the folders of the app's earlier names), the speech engine with its models
; (%LOCALAPPDATA%\Altype) and the transcripts (Documents\Altype). No keeps
; everything for a later install; an update never asks and never deletes.
; Notes in the person's knowledge base are theirs and are never touched.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      SetShellVarContext current
      StrCpy $0 "keep"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Delete Altype's data too?$\r$\n$\r$\nYes removes the settings, the saved words, the dictionaries, the translator and the voice, the speech engine with its models, and the transcripts in Documents\Altype.$\r$\n$\r$\nNo keeps all of it for a later install. Notes in your knowledge base stay either way." \
        IDNO +2
      StrCpy $0 "delete"
      ${if} $0 == "delete"
        RMDir /r "$APPDATA\Altype"
        RMDir /r "$APPDATA\2Talker"
        RMDir /r "$APPDATA\tu-talk"
        RMDir /r "$LOCALAPPDATA\Altype"
        RMDir /r "$DOCUMENTS\Altype"
      ${endif}
    ${endIf}
  ${endIf}
!macroend
