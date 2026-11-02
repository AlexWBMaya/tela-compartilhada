@echo off
title ScreenSquad Pro - Compartilhamento Multi-Tela 60/120 FPS
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
    echo Instalando dependencias pela primeira vez...
    call npm install
    node node_modules/electron/install.js
)
start "" "node_modules\electron\dist\electron.exe" .
