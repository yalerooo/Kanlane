@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not %ERRORLEVEL%==0 (
    echo No se encontro Node.js en este equipo.
    echo Instalalo desde https://nodejs.org y vuelve a intentarlo.
    pause
    exit /b 1
)

echo Iniciando Workhub en local (se recarga solo al guardar archivos)...
start "" http://localhost:5500
node scripts\dev.js %*
pause
