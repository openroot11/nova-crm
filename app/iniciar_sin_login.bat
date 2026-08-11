@echo off
title CRM Operativo Nova (SIN LOGIN - solo pruebas)
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
echo Iniciando el CRM SIN pantalla de login (modo prueba)...
echo Cualquiera con la URL entra directo como admin, sin usuario ni contraseña.
echo No uses este modo si el equipo va a manejar datos reales de clientes.
echo No cierres esta ventana mientras lo estes usando.
echo.
set NOVA_DISABLE_AUTH=true
node index.js

pause
