@echo off
rem Lanzador para la tarea programada de autoarranque (ver Task Scheduler:
rem "Nova CRM - Autoarranque"). No usar a mano -- para arrancar manualmente
rem usa iniciar.bat en la carpeta raiz, que si muestra la consola.
cd /d "%~dp0"
if not exist logs mkdir logs

if not exist node_modules (
  call npm install >> logs\nova-crm.log 2>&1
)

echo ============================================== >> logs\nova-crm.log
echo Arranque automatico: %date% %time% >> logs\nova-crm.log
node index.js >> logs\nova-crm.log 2>&1
echo Proceso node termino (%date% %time%), codigo %errorlevel% >> logs\nova-crm.log
