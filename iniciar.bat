@echo off
title Nova CRM
cd /d "%~dp0server"

if not exist node_modules (
  echo Instalando dependencias por primera vez, espera un momento...
  call npm install
  if errorlevel 1 (
    echo.
    echo Hubo un error instalando dependencias. Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando Nova CRM...
echo No cierres esta ventana mientras el equipo la este usando.
echo.
node index.js

pause
