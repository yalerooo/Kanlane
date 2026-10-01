@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    set "PYCMD=python"
) else (
    where py >nul 2>nul
    if %ERRORLEVEL%==0 (
        set "PYCMD=py"
    ) else (
        echo No se encontro Python instalado en este equipo.
        echo Instalalo desde https://www.python.org/downloads/ y vuelve a intentarlo.
        pause
        exit /b 1
    )
)

echo Iniciando el Tablero en http://localhost:5500 ...
start "Tablero - servidor local (no cierres esta ventana)" cmd /k %PYCMD% -m http.server 5500
timeout /t 2 /nobreak >nul
start "" http://localhost:5500/app/

exit /b 0
