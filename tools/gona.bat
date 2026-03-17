@echo off
setlocal

set "GONA_SOURCE_DIR=C:\Users\sunzhsh\.codex\skills\gona\scripts"
set "GONA_RUNTIME_DIR=%~dp0gona_runtime"
set "GONA_LOCAL_LAUNCHER=%GONA_RUNTIME_DIR%\gona_launcher.bat"

if not exist "%GONA_SOURCE_DIR%\gona_launcher.bat" (
  echo [gona-wrapper] Source launcher not found: "%GONA_SOURCE_DIR%\gona_launcher.bat"
  exit /b 1
)

if not exist "%GONA_RUNTIME_DIR%" (
  mkdir "%GONA_RUNTIME_DIR%" >nul 2>nul
)

copy /Y "%GONA_SOURCE_DIR%\gona_launcher.bat" "%GONA_RUNTIME_DIR%\gona_launcher.bat" >nul
if errorlevel 1 (
  echo [gona-wrapper] Failed to copy launcher into project: "%GONA_LOCAL_LAUNCHER%"
  exit /b 1
)

copy /Y "%GONA_SOURCE_DIR%\gona_launcher.py" "%GONA_RUNTIME_DIR%\gona_launcher.py" >nul
if errorlevel 1 (
  echo [gona-wrapper] Failed to copy runtime dependency: "%GONA_RUNTIME_DIR%\gona_launcher.py"
  exit /b 1
)

copy /Y "%GONA_SOURCE_DIR%\gona_terminal_bootstrap.ps1" "%GONA_RUNTIME_DIR%\gona_terminal_bootstrap.ps1" >nul
if errorlevel 1 (
  echo [gona-wrapper] Failed to copy runtime dependency: "%GONA_RUNTIME_DIR%\gona_terminal_bootstrap.ps1"
  exit /b 1
)

call "%GONA_LOCAL_LAUNCHER%" %*
exit /b %ERRORLEVEL%
