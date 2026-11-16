' AUTOJIRA - silent (hidden console) proxy server launcher
' Registered in Startup folder; runs at login
Set fs = CreateObject("Scripting.FileSystemObject")
scriptDir = fs.GetParentFolderName(Wscript.ScriptFullName)
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = scriptDir
' 0 = hide window, False = async; logs are appended to server.log
ws.Run "cmd /c node server.js >> server.log 2>&1", 0, False
