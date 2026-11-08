#!/usr/bin/env bash
# ==============================================================================
# Script de Diagnóstico do Sistema para Tela Compartilhada (Linux)
# Compatível com CachyOS, Arch Linux, Ubuntu, Debian, Fedora, openSUSE, etc.
# ==============================================================================

set -u

LOG_FILE="diagnostico_tela.log"
APP_IMAGE=""

# Cores para o terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "================================================================"
echo "    COLETOR DE DIAGNÓSTICO - TELA COMPARTILHADA (LINUX)        "
echo "================================================================"
echo -e "${NC}"

# 1. Localizar o AppImage
if [ $# -ge 1 ] && [ -f "$1" ]; then
    APP_IMAGE="$1"
elif [ -f "./TelaCompartilhada.AppImage" ]; then
    APP_IMAGE="./TelaCompartilhada.AppImage"
elif [ -f "$HOME/Downloads/TelaCompartilhada.AppImage" ]; then
    APP_IMAGE="$HOME/Downloads/TelaCompartilhada.AppImage"
elif [ -f "./dist/TelaCompartilhada.AppImage" ]; then
    APP_IMAGE="./dist/TelaCompartilhada.AppImage"
fi

if [ -z "$APP_IMAGE" ]; then
    echo -e "${YELLOW}Aviso: Não encontramos o 'TelaCompartilhada.AppImage' no diretório atual nem em ~/Downloads.${NC}"
    read -rp "Por favor, digite o caminho para o arquivo .AppImage: " USER_INPUT_PATH
    if [ -f "$USER_INPUT_PATH" ]; then
        APP_IMAGE="$USER_INPUT_PATH"
    else
        echo -e "${RED}Arquivo não encontrado: $USER_INPUT_PATH${NC}"
        echo "Continuando a coleta de informações do sistema sem executar o app..."
    fi
fi

echo -e "${BLUE}[1/5] Coletando informações do sistema operacional e ambiente gráfico...${NC}"

{
    echo "=================================================================="
    echo "RELATÓRIO DE DIAGNÓSTICO DO SISTEMA (TELA COMPARTILHADA)"
    echo "Data da coleta: $(date)"
    echo "=================================================================="
    echo ""
    echo "--- [1] KERNEL & SISTEMA OPERACIONAL ---"
    uname -a
    if [ -f /etc/os-release ]; then
        cat /etc/os-release
    fi
    echo ""
    echo "--- [2] SESSÃO GRÁFICA & DESKTOP ---"
    echo "XDG_SESSION_TYPE: ${XDG_SESSION_TYPE:-não definido}"
    echo "XDG_CURRENT_DESKTOP: ${XDG_CURRENT_DESKTOP:-não definido}"
    echo "DESKTOP_SESSION: ${DESKTOP_SESSION:-não definido}"
    echo "WAYLAND_DISPLAY: ${WAYLAND_DISPLAY:-não definido}"
    echo "DISPLAY: ${DISPLAY:-não definido}"
    echo ""
    echo "--- [3] PLACA DE VÍDEO & DRIVER ---"
    if command -v lspci &>/dev/null; then
        lspci -k | grep -EA3 'VGA|3D' || true
    else
        echo "lspci não disponível."
    fi
    echo ""
    echo "--- [4] SERVIÇOS PIPEWIRE / ÁUDIO ---"
    systemctl --user status pipewire pipewire-pulse wireplumber --no-pager 2>&1 || true
    echo ""
    echo "--- [5] XDG-DESKTOP-PORTAL (ESSENCIAL PARA CAPTURA NO WAYLAND) ---"
    systemctl --user status "xdg-desktop-portal*" --no-pager 2>&1 || true
    echo ""
    echo "Processos de portal em execução:"
    ps aux | grep -i portal | grep -v grep || echo "Nenhum processo de portal encontrado!"
    echo ""
    echo "--- [6] PACOTES DE PORTAL INSTALADOS ---"
    if command -v pacman &>/dev/null; then
        pacman -Qs portal 2>&1 || true
    elif command -v dpkg &>/dev/null; then
        dpkg -l | grep -i portal 2>&1 || true
    elif command -v rpm &>/dev/null; then
        rpm -qa | grep -i portal 2>&1 || true
    fi
    echo ""
    echo "--- [7] TESTE D-BUS DO PORTAL DE SCREENCAST ---"
    if command -v gdbus &>/dev/null; then
        gdbus call --session \
            --dest org.freedesktop.portal.Desktop \
            --object-path /org/freedesktop/portal/desktop \
            --method org.freedesktop.DBus.Properties.Get org.freedesktop.portal.ScreenCast version 2>&1 || true
    else
        echo "gdbus não disponível para teste direto."
    fi
    echo ""
} > "$LOG_FILE"

echo -e "${GREEN}✓ Informações do sistema coletadas.${NC}"

# Execução do aplicativo com logging
if [ -n "$APP_IMAGE" ] && [ -f "$APP_IMAGE" ]; then
    chmod +x "$APP_IMAGE"
    echo ""
    echo -e "${CYAN}${BOLD}[2/5] INICIANDO O APLICATIVO COM LOGS DETALHADOS...${NC}"
    echo -e "${YELLOW}-> O aplicativo vai abrir agora."
    echo -e "-> Entre na sala e clique em '${BOLD}Transmitir tela${NC}${YELLOW}' para reproduzir o problema."
    echo -e "-> Assim que o erro aparecer ou você terminar o teste, ${BOLD}feche o aplicativo${NC}${YELLOW}.${NC}"
    echo ""
    read -rp "Pressione [ENTER] para iniciar o app..."

    echo "" >> "$LOG_FILE"
    echo "--- [8] LOGS DE EXECUÇÃO DO CHROMIUM / ELECTRON / WEBRTC ---" >> "$LOG_FILE"
    echo "Executando: $APP_IMAGE --enable-logging=stderr --v=1" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    # Executa o AppImage capturando stdout e stderr em tempo real para a tela e para o arquivo de log
    "$APP_IMAGE" --enable-logging=stderr --v=1 2>&1 | tee -a "$LOG_FILE" || true

    echo ""
    echo -e "${GREEN}✓ Aplicativo encerrado.${NC}"
else
    echo -e "${YELLOW}Pulando execução do aplicativo.${NC}"
fi

echo -e "${BLUE}[3/5] Coletando logs recentes do journal do sistema (xdg-desktop-portal & pipewire)...${NC}"
{
    echo ""
    echo "--- [9] JOURNAL RECENTE DO XDG-DESKTOP-PORTAL ---"
    journalctl --user -u "xdg-desktop-portal*" -n 60 --no-pager 2>&1 || true
    echo ""
    echo "--- [10] JOURNAL RECENTE DO PIPEWIRE ---"
    journalctl --user -u pipewire -n 40 --no-pager 2>&1 || true
    echo ""
} >> "$LOG_FILE"

echo -e "${GREEN}✓ Logs adicionais coletados.${NC}"

echo ""
echo -e "${CYAN}================================================================${NC}"
echo -e "${GREEN}${BOLD}DIAGNÓSTICO CONCLUÍDO COM SUCESSO!${NC}"
echo -e "O arquivo gerado é: ${BOLD}${YELLOW}$LOG_FILE${NC}"
echo -e "${CYAN}================================================================${NC}"
echo ""

# Destaques automáticos no terminal
echo -e "${BOLD}Resumo do seu ambiente:${NC}"
grep -E 'XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|NAME=' "$LOG_FILE" | head -n 4

echo ""
echo -e "${BOLD}Possíveis erros detectados nos logs:${NC}"
ERRORS_FOUND=$(grep -inE 'error|fail|notallowed|denied|pipewire.*err|portal.*err|crash' "$LOG_FILE" | grep -v 'spellcheck' | head -n 12 || true)
if [ -n "$ERRORS_FOUND" ]; then
    echo -e "${RED}$ERRORS_FOUND${NC}"
else
    echo -e "${GREEN}Nenhum erro crítico óbvio destacado na busca rápida.${NC}"
fi

echo ""
echo -e "${YELLOW}${BOLD}O que fazer agora:${NC}"
echo -e "Envie o arquivo ${BOLD}$LOG_FILE${NC} ou copie o seu conteúdo para descobrirmos a causa exata!"
