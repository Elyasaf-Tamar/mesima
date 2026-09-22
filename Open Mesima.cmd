@echo off
if exist "%~dp0desktop\dist\Mesima-win32-x64\Mesima.exe" (
  start "" "%~dp0desktop\dist\Mesima-win32-x64\Mesima.exe"
) else (
  start "" "%~dp0Mesima-win32-x64\Mesima.exe"
)
