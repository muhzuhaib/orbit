; Custom NSIS hooks for the Orbit installer.
;
; On a real (interactive) uninstall we ask whether to also delete the user's
; Orbit data — chats, projects, settings and stored API keys — so someone who
; wants a clean reinstall can wipe everything, while a normal uninstall (or an
; auto-update, which runs the uninstaller SILENTLY) keeps the data untouched.

!macro customUnInstall
  ; Skip the prompt during silent runs (auto-update reinstall) — never delete
  ; data behind the user's back.
  IfSilent orbit_keep_data

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you also want to delete your Orbit data (chats, projects, settings and saved API keys)?$\r$\n$\r$\nChoose No to keep it for a future reinstall." \
    /SD IDNO IDNO orbit_keep_data

  ; User chose Yes — remove the app's data directories.
  RMDir /r "$APPDATA\Orbit"
  RMDir /r "$LOCALAPPDATA\Orbit"

  orbit_keep_data:
!macroend
