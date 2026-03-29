@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

start "clibees-ui-api" cmd /k "cd /d ""%ROOT%"" && npm run ui-api"
start "clibees-console" cmd /k "cd /d ""%ROOT%\apps\console"" && npm run dev"
