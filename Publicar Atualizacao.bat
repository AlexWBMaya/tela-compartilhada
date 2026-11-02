@echo off
chcp 65001 >nul
title Publicar Nova Versao no GitHub
cd /d "%~dp0"

echo ========================================================
echo 1. Subindo o numero da versao no package.json...
echo ========================================================
call npm version patch --no-git-tag-version

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
echo Nova versao: v%VERSION%

echo ========================================================
echo 2. Gerando novo TelaCompartilhada.exe...
echo ========================================================
call npm run build-exe
copy /y "dist\TelaCompartilhada.exe" "TelaCompartilhada.exe" >nul

echo ========================================================
echo 3. Enviando codigo e criando Release v%VERSION% no GitHub...
echo ========================================================
git add .
git commit -m "Versao v%VERSION%"
git push origin main
gh release create "v%VERSION%" "dist\TelaCompartilhada.exe" --title "v%VERSION%" --notes "Atualizacao v%VERSION%"

echo ========================================================
echo Pronto! Seus amigos ja vao ver o botao de atualizar para v%VERSION% no app.
echo ========================================================
pause
