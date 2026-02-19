Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d D:\Users\toph\Documents\tophoftheworld.github.io && python -m http.server 8080", 0, False
Set WshShell = Nothing










