#!/usr/bin/env bash
# ==============================================================================
# Script de Teste e Diagnóstico Rápido para Placas NVIDIA / Linux
# Tela Compartilhada (CachyOS, Arch, Ubuntu, Fedora, Debian, etc.)
# ==============================================================================

set -u

REPO="AlexWBMaya/tela-compartilhada"
RELEASE_TAG="v1.5.10"
EXPECTED_SHA256="4ce0bce122069afebe01310c3e173634d9d97ffc14c894c12a6ec03d8fe8a969"
APP_IMAGE="./TelaCompartilhada.AppImage"
LOG_FILE="log_teste_amigo.log"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo -e "${CYAN}${BOLD}"
echo "=================================================================="
echo "    TELA COMPARTILHADA - ASSISTENTE DE TESTE & COMPATIBILIDADE   "
echo "                   (Especial para Linux & NVIDIA)                 "
echo "=================================================================="
echo -e "${NC}"

# 1. Informações básicas do hardware
echo -e "${BLUE}=== [1] DETECTANDO HARDWARE & AMBIENTE GRÁFICO ===${NC}"
DISTRO=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s)
SESSION="${XDG_SESSION_TYPE:-desconhecido}"
DESKTOP="${XDG_CURRENT_DESKTOP:-desconhecido}"
echo -e "Sistema:  ${BOLD}${DISTRO}${NC}"
echo -e "Ambiente: ${BOLD}${DESKTOP} (${SESSION})${NC}"

GPU_INFO="Desconhecida"
IS_NVIDIA=false
if command -v lspci &>/dev/null; then
    GPU_RAW=$(lspci | grep -iE 'vga|3d|display' | head -n 1 || true)
    if echo "$GPU_RAW" | grep -qi "nvidia"; then
        IS_NVIDIA=true
        GPU_INFO=$(echo "$GPU_RAW" | sed 's/.*: //')
        echo -e "GPU:      ${MAGENTA}${BOLD}${GPU_INFO} [NVIDIA Detectada]${NC}"
    else
        GPU_INFO=$(echo "$GPU_RAW" | sed 's/.*: //')
        echo -e "GPU:      ${GREEN}${GPU_INFO}${NC}"
    fi
fi

if [ "$IS_NVIDIA" = true ] && [ "$SESSION" = "wayland" ]; then
    echo -e "${YELLOW}Aviso Importante:${NC} No Wayland com NVIDIA, o Electron às vezes cai em modo XWayland,"
    echo -e "fazendo com que a captura de tela tente passar texturas de GPU (DMA-BUF) que o driver bloqueia."
    echo -e "As opções [1] e [2] abaixo foram desenvolvidas especialmente para resolver isso."
fi
echo ""

# 2. Verificar ou baixar o AppImage
baixar_appimage() {
    echo -e "${CYAN}Baixando a versão oficial ${BOLD}${RELEASE_TAG}${NC}${CYAN} do GitHub...${NC}"
    URL="https://github.com/$REPO/releases/download/$RELEASE_TAG/TelaCompartilhada.AppImage"
    rm -f "$APP_IMAGE"
    if command -v curl &>/dev/null; then
        curl -fL "$URL" -o "$APP_IMAGE" --progress-bar
    elif command -v wget &>/dev/null; then
        wget -O "$APP_IMAGE" "$URL" --show-progress
    else
        echo -e "${RED}Erro: Nem 'curl' nem 'wget' foram encontrados no sistema.${NC}"
        return 1
    fi

    if [ -f "$APP_IMAGE" ]; then
        chmod +x "$APP_IMAGE"
        echo -e "${GREEN}✓ AppImage atualizado com sucesso para ${RELEASE_TAG}!${NC}\n"
    else
        echo -e "${RED}Falha ao baixar o arquivo.${NC}\n"
        return 1
    fi
}

if [ ! -f "$APP_IMAGE" ]; then
    echo -e "${YELLOW}O arquivo '${APP_IMAGE}' não foi encontrado nesta pasta.${NC}"
    baixar_appimage || exit 1
else
    chmod +x "$APP_IMAGE"
    TAMANHO=$(ls -lh "$APP_IMAGE" | awk '{print $5}')
    CURRENT_HASH=""
    if command -v sha256sum &>/dev/null; then
        CURRENT_HASH=$(sha256sum "$APP_IMAGE" | awk '{print $1}')
    fi
    if [ "$CURRENT_HASH" != "$EXPECTED_SHA256" ]; then
        echo -e "${RED}${BOLD}ATENÇÃO: O AppImage local é antigo (não é a v1.5.8 corrigida)!${NC}"
        read -rp "Deseja baixar a v1.5.8 corrigida agora? (S/n): " AUTO_DOWN
        if [[ ! "$AUTO_DOWN" =~ ^[Nn] ]]; then
            baixar_appimage || exit 1
        fi
    else
        echo -e "${GREEN}✓ AppImage confirmado: v1.5.8 oficial (${TAMANHO})${NC}"
    fi
fi

# Menu Interativo
mostrar_menu() {
    echo -e "${CYAN}==================================================================${NC}"
    echo -e "${BOLD}ESCOLHA COMO VOCÊ DESEJA INICIAR O APLICATIVO:${NC}"
    echo -e "${CYAN}==================================================================${NC}"
    echo -e " ${BOLD}[1]${NC} ${GREEN}${BOLD}Modo Wayland Nativo (Recomendado para NVIDIA + Wayland)${NC}"
    echo -e "     -> Força o aplicativo a rodar em Wayland puro sem passar por XWayland."
    echo -e "     -> Permite que os buffers do KWin/PipeWire cheguem diretamente à GPU."
    echo ""
    echo -e " ${BOLD}[2]${NC} ${YELLOW}${BOLD}Modo Memória Compartilhada / CPU (100% à prova de falhas NVIDIA)${NC}"
    echo -e "     -> Desativa captura por textura de GPU e usa buffers de memória RAM (SHM)."
    echo -e "     -> Bypassa completamente qualquer incompatibilidade do driver gráfico NVIDIA."
    echo ""
    echo -e " ${BOLD}[3]${NC} ${BLUE}Modo Padrão da v1.5.8${NC}"
    echo -e "     -> Inicia com a detecção padrão da nova versão."
    echo ""
    echo -e " ${BOLD}[4]${NC} ${MAGENTA}Modo Diagnóstico com Log em Tempo Real${NC}"
    echo -e "     -> Grava e exibe logs do WebRTC e PipeWire para identificar gargalos."
    echo ""
    echo -e " ${BOLD}[5]${NC} ${CYAN}Atualizar / Baixar novamente o AppImage da v1.5.8${NC}"
    echo ""
    echo -e " ${BOLD}[0]${NC} Sair"
    echo -e "${CYAN}==================================================================${NC}"
}

OPCAO="${1:-}"

if [ -z "$OPCAO" ]; then
    mostrar_menu
    read -rp "Digite o número da opção desejada [1-5]: " OPCAO
fi

case "$OPCAO" in
    1)
        echo -e "\n${GREEN}${BOLD}Iniciando no Modo Wayland Nativo...${NC}"
        echo -e "Flags: --ozone-platform=wayland --enable-features=WaylandWindowDecorations\n"
        exec "$APP_IMAGE" --ozone-platform=wayland --enable-features=WaylandWindowDecorations "$@"
        ;;
    2)
        echo -e "\n${YELLOW}${BOLD}Iniciando no Modo Seguro de Memória / CPU (Sem GPU)...${NC}"
        echo -e "Flags: --disable-gpu\n"
        exec "$APP_IMAGE" --disable-gpu "$@"
        ;;
    3)
        echo -e "\n${BLUE}${BOLD}Iniciando no Modo Padrão da v1.5.8...${NC}\n"
        exec "$APP_IMAGE" "$@"
        ;;
    4)
        echo -e "\n${MAGENTA}${BOLD}Iniciando no Modo Diagnóstico com Registro em: ${LOG_FILE}...${NC}"
        echo -e "${YELLOW}Ao terminar de testar, feche o aplicativo para ver o resumo do teste.${NC}\n"
        "$APP_IMAGE" --enable-logging=stderr --v=1 2>&1 | tee "$LOG_FILE"
        
        echo ""
        echo -e "${CYAN}=== RESUMO DO TESTE DE VÍDEO / ENCODER ===${NC}"
        if grep -qi "Dropping frame" "$LOG_FILE"; then
            echo -e "${RED}[ALERTA] Frames foram descartados pelo encoder WebRTC.${NC}"
        else
            echo -e "${GREEN}[OK] Nenhum frame foi descartado por sobrecarga de bitrate.${NC}"
        fi
        
        if grep -qi "PipeWire remote opened" "$LOG_FILE"; then
            echo -e "${GREEN}[OK] PipeWire conectou e entregou fluxo de captura com sucesso.${NC}"
        fi

        TEXTURE_LINE=$(grep -m 1 "texture=" "$LOG_FILE" || true)
        if [ -n "$TEXTURE_LINE" ]; then
            echo -e "Tipo de buffer capturado: ${YELLOW}$TEXTURE_LINE${NC}"
        fi
        echo -e "O log completo foi salvo em: ${BOLD}${LOG_FILE}${NC}"
        ;;
    5)
        baixar_appimage
        echo -e "Pressione ENTER para voltar ao menu..."
        read -r
        exec "$0"
        ;;
    0)
        echo "Saindo..."
        exit 0
        ;;
    *)
        echo -e "${RED}Opção inválida.${NC}"
        exit 1
        ;;
esac
