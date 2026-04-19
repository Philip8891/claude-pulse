' Claude Pulse - developer autostart script (dev mode only)
'
' This script is for DEVELOPMENT autostart. It runs `npm start` silently.
' If you're using the installed .exe, use the Start menu shortcut instead:
'   1. Press Win+R, type: shell:startup
'   2. Drag the Claude Pulse shortcut from your Start menu into that folder
'
' To use this script for dev autostart:
'   1. Edit the path below to match your claude-pulse folder
'   2. Press Win+R, type: shell:startup
'   3. Copy this .vbs file into that folder

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\claude-pulse"
sh.Run "cmd /c npm start", 0, False
