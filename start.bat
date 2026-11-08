@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LectorStudio - biblioteca en voz alta

set "LAN="
set "BROWSER="
set "EDGE="
for %%A in (%*) do (
  if /i "%%A"=="--lan" set "LAN=--lan"
  if /i "%%A"=="red" set "LAN=--lan"
  if /i "%%A"=="--edge" set "BROWSER=--browser edge"
)
if defined BROWSER set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

rem Si ya hay una instancia respondiendo, solo abrir la ventana del navegador.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8840/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  if defined EDGE if exist "%EDGE%" (
    start "" "%EDGE%" "http://127.0.0.1:8840/"
    exit /b 0
  )
  start "" "http://127.0.0.1:8840/"
  exit /b 0
)

echo.
echo   LECTORSTUDIO
echo   ----------------------------------------
echo   Biblioteca local, OCR y lectura en voz alta.
echo   Todo ocurre en este dispositivo.
echo.
if defined BROWSER if not exist "%EDGE%" echo   No encontre Microsoft Edge; abro el navegador predeterminado.
echo.

where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py --open %LAN% %BROWSER%
  goto :end
)
where python >nul 2>nul
if errorlevel 1 goto :nopython
python server.py --open %LAN% %BROWSER%
goto :end

:nopython
echo.
echo   No encontre Python.
echo   Instala Python 3.10 o superior desde https://www.python.org/downloads/
echo   y marca la opcion "Add python.exe to PATH".
echo.
pause
exit /b 1

:end
if errorlevel 1 (
  echo.
  echo   El servidor se detuvo con un error. Revisa la ventana.
  pause
)
exit /b 0
