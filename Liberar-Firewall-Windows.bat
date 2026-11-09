@echo off
:: Solicita elevação de privilégios de administrador caso não esteja rodando como admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Solicitando permissoes de Administrador...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ====================================================================
echo   CONFIGURANDO FIREWALL DO WINDOWS PARA O TELA COMPARTILHADA
echo ====================================================================
echo.

:: Remove regras antigas obsoletas
netsh advfirewall firewall delete rule name="TelaCompartilhada" >nul 2>&1
netsh advfirewall firewall delete rule name="TelaCompartilhada-Temp" >nul 2>&1
netsh advfirewall firewall delete rule name="TelaCompartilhada-Local" >nul 2>&1
netsh advfirewall firewall delete rule name="TelaCompartilhada-Dist" >nul 2>&1

:: Adiciona regras de entrada para permitir UDP e TCP em todos os perfis (Privado e Público)
netsh advfirewall firewall add rule name="TelaCompartilhada-Temp" dir=in action=allow program="%LOCALAPPDATA%\Temp\TelaCompartilhada\TelaCompartilhada.exe" enable=yes profile=any
netsh advfirewall firewall add rule name="TelaCompartilhada-Local" dir=in action=allow program="%~dp0TelaCompartilhada.exe" enable=yes profile=any
netsh advfirewall firewall add rule name="TelaCompartilhada-Dist" dir=in action=allow program="%~dp0dist\win-unpacked\TelaCompartilhada.exe" enable=yes profile=any

echo.
echo ====================================================================
echo   REGRAS DE FIREWALL ADICIONADAS COM SUCESSO!
echo ====================================================================
echo O Firewall do Windows agora permite o recebimento de transmissao (UDP e TCP).
echo.
pause
