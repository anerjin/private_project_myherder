@echo off
rem Double-click installer: runs install.ps1, passing arguments through (e.g. install.cmd -Online)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
