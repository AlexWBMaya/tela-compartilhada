#!/usr/bin/env bash
# ==============================================================================
# Script de Coleta e Diagnóstico Preciso para Tela Compartilhada (Linux)
# Detecta versão real do AppImage, força v1.5.8, e coleta logs de WebRTC/NVIDIA
# ==============================================================================

set -u

REPO="AlexWBMaya/tela-compartilhada"
EXPECTED_TAG="v1.5.10"
EXPECTED_SHA256="0423746efa3527879f231fa2066d8a00aeb9b8f806df8adb03f78e149a0d256f"
APP_IMAGE="./TelaCompartilhada.AppImage"
LOG_RAW="webrtc_debug.log"
REPORT="relatorio_amigo.txt"

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
echo "      DIAGNÓSTICO AVANÇADO DE VÍDEO & WEBRTC (LINUX / NVIDIA)     "
echo "=================================================================="
echo -e "${NC}"

# 1. Informações do Ambiente
echo -e "${BLUE}[1/4] Verificando Sistema e GPU...${NC}"
DISTRO=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s)
SESSION="${XDG_SESSION_TYPE:-desconhecido}"
DESKTOP="${XDG_CURRENT_DESKTOP:-desconhecido}"
KERNEL=$(uname -r)
echo "Sistema:  $DISTRO (Kernel $KERNEL)"
echo "Sessão:   $DESKTOP ($SESSION)"

GPU_INFO="Desconhecida"
if command -v lspci &>/dev/null; then
    GPU_INFO=$(lspci | grep -iE 'vga|3d|display' | head -n 1 | sed 's/.*: //')
fi
echo "GPU:      $GPU_INFO"
echo ""

# 2. Verificar a versão exata do AppImage
echo -e "${BLUE}[2/4] Verificando integridade e versão do AppImage...${NC}"
BAIXAR=false

if [ ! -f "$APP_IMAGE" ]; then
    echo -e "${YELLOW}AppImage não encontrado no diretório atual.${NC}"
    BAIXAR=true
else
    TAMANHO=$(ls -lh "$APP_IMAGE" | awk '{print $5}')
    CURRENT_HASH=""
    if command -v sha256sum &>/dev/null; then
        CURRENT_HASH=$(sha256sum "$APP_IMAGE" | awk '{print $1}')
    fi

    echo "Arquivo:  $APP_IMAGE ($TAMANHO)"
    echo "SHA256:   $CURRENT_HASH"

    if [ "$CURRENT_HASH" != "$EXPECTED_SHA256" ]; then
        echo -e "${RED}${BOLD}"
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        echo " ATENÇÃO: O AppImage atual NÃO É a versão mais recente (v1.5.8)!"
        echo " Você estava executando uma versão antiga que ainda tinha o bug!"
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        echo -e "${NC}"
        read -rp "Deseja baixar a versão v1.5.8 corrigida agora? (S/n): " RESPOSTA
        if [[ "$RESPOSTA" =~ ^[Nn] ]]; then
            echo "Continuando com o arquivo atual..."
        else
            BAIXAR=true
        fi
    else
        echo -e "${GREEN}✓ AppImage é exatamente a versão oficial corrigida (v1.5.8).${NC}"
    fi
fi

if [ "$BAIXAR" = true ]; then
    echo -e "${CYAN}Baixando TelaCompartilhada.AppImage (v1.5.8) do GitHub...${NC}"
    URL="https://github.com/$REPO/releases/download/$EXPECTED_TAG/TelaCompartilhada.AppImage"
    rm -f "$APP_IMAGE"
    if command -v curl &>/dev/null; then
        curl -fL "$URL" -o "$APP_IMAGE" --progress-bar
    elif command -v wget &>/dev/null; then
        wget -O "$APP_IMAGE" "$URL" --show-progress
    fi
    chmod +x "$APP_IMAGE"
    echo -e "${GREEN}✓ Download concluído com sucesso!${NC}\n"
fi

chmod +x "$APP_IMAGE"

# 3. Menu de execução
echo -e "\n${BLUE}[3/4] Escolha como deseja executar o teste:${NC}"
echo -e " ${BOLD}[1]${NC} Modo Wayland Nativo com Log (--ozone-platform=wayland)"
echo -e " ${BOLD}[2]${NC} Modo Sem GPU / Memória de Sistema com Log (--disable-gpu)"
echo -e " ${BOLD}[3]${NC} Modo Padrão v1.5.8 com Log"
read -rp "Opção [1, 2 ou 3] (Recomendado: 1): " MODO_ESCOLHIDO

EXTRA_FLAGS=""
NOME_MODO="Padrão"
case "${MODO_ESCOLHIDO:-1}" in
    1)
        EXTRA_FLAGS="--ozone-platform=wayland --enable-features=WaylandWindowDecorations"
        NOME_MODO="Wayland Nativo"
        ;;
    2)
        EXTRA_FLAGS="--disable-gpu"
        NOME_MODO="Sem GPU (Memória CPU)"
        ;;
    *)
        EXTRA_FLAGS=""
        NOME_MODO="Padrão"
        ;;
esac

echo ""
echo -e "${CYAN}${BOLD}==================================================================${NC}"
echo -e "${GREEN}${BOLD}INICIANDO O APLICATIVO NO MODO: ${NOME_MODO}${NC}"
echo -e "${YELLOW}INSTRUÇÕES:${NC}"
echo -e "1. O app vai abrir agora."
echo -e "2. Entre na mesma sala que seu amigo (Windows)."
echo -e "3. Clique em '${BOLD}Transmitir tela${NC}${YELLOW}' e selecione sua tela."
echo -e "4. Aguarde ~10 a 15 segundos para transmitir."
echo -e "5. ${BOLD}Feche o aplicativo${NC}${YELLOW} para gerar o relatório final.${NC}"
echo -e "${CYAN}${BOLD}==================================================================${NC}"
read -rp "Pressione [ENTER] para abrir o app..."

# Executa capturando log completo
rm -f "$LOG_RAW"
"$APP_IMAGE" $EXTRA_FLAGS --enable-logging=stderr --v=1 2>&1 | tee "$LOG_RAW" || true

echo ""
echo -e "${BLUE}[4/4] Gerando relatório de diagnóstico resumido...${NC}"

# 4. Gerar relatório formatado
{
    echo "=================================================================="
    echo "RELATÓRIO DE DIAGNÓSTICO WEBRTC / LINUX (TELA COMPARTILHADA)"
    echo "Data: $(date)"
    echo "=================================================================="
    echo "SISTEMA:        $DISTRO"
    echo "KERNEL:         $KERNEL"
    echo "SESSÃO:         $DESKTOP ($SESSION)"
    echo "GPU:            $GPU_INFO"
    echo "MODO TESTADO:   $NOME_MODO ($EXTRA_FLAGS)"
    echo "HASH APPIMAGE:  $(sha256sum "$APP_IMAGE" 2>/dev/null | awk '{print $1}')"
    echo ""
    echo "--- [1] PIPEWIRE & PORTAL ---"
    grep -iE "PipeWire remote opened|PipeWire stream format changed|Opening the PipeWire remote" "$LOG_RAW" | tail -n 10 || echo "Nenhum evento PipeWire registrado."
    echo ""
    echo "--- [2] CONFIGURAÇÃO DO ENCODER WEBRTC ---"
    grep -iE "ReconfigureEncoder|SetStartBitrate|start bitrate|content_type|frame_drop_enabled" "$LOG_RAW" | tail -n 15 || echo "Nenhum evento de encoder registrado."
    echo ""
    echo "--- [3] DESCARTE DE FRAMES (FRAME DROPPING) ---"
    DROPPED=$(grep -ic "Dropping frame" "$LOG_RAW" || true)
    echo "Total de frames descartados por sobrecarga: $DROPPED"
    if [ "$DROPPED" -gt 0 ]; then
        echo "Exemplos de descarte:"
        grep -i "Dropping frame" "$LOG_RAW" | tail -n 5
    fi
    echo ""
    echo "--- [4] ESTATÍSTICAS DE ENVIO DE VÍDEO (VideoSendStream) ---"
    grep -i "VideoSendStream stats" "$LOG_RAW" | tail -n 5 || echo "Nenhum dado de VideoSendStream registrado."
    echo ""
    echo "--- [5] LARGURA DE BANDA E BITRATE (Call stats) ---"
    grep -i "Call stats" "$LOG_RAW" | tail -n 5 || echo "Nenhum dado de Call stats registrado."
    echo ""
    echo "--- [6] SDP BITRATE NEGOCIADO ---"
    grep -iE "x-google-start-bitrate|x-google-min-bitrate|b=AS:" "$LOG_RAW" | tail -n 5 || echo "Nenhum SDP modificado encontrado no log."
    echo ""
    echo "--- [7] CONEXÕES ICE E REDE ---"
    grep -iE "Conn\[.*Selected|UpdateState.*selected" "$LOG_RAW" | tail -n 10 || echo "Nenhuma conexão selecionada encontrada."
    echo ""
    echo "--- [8] ERROS / EXCEÇÕES NO LOG ---"
    grep -iE "ERROR:|FATAL:|uncaught|exception" "$LOG_RAW" | tail -n 15 || echo "Nenhum erro crítico registrado."
    echo "=================================================================="
} > "$REPORT"

echo -e "${GREEN}${BOLD}✓ RELATÓRIO GERADO COM SUCESSO EM: ${YELLOW}$REPORT${NC}"
echo ""
echo -e "${CYAN}=== RESUMO DO TESTE ===${NC}"
DROPPED_COUNT=$(grep -ic "Dropping frame" "$LOG_RAW" || true)
if [ "$DROPPED_COUNT" -eq 0 ]; then
    echo -e "Descarte de frames:  ${GREEN}[OK] 0 frames descartados!${NC}"
else
    echo -e "Descarte de frames:  ${RED}[ALERTA] $DROPPED_COUNT frames descartados!${NC}"
fi

ENCODE_STATS=$(grep -i "VideoSendStream stats" "$LOG_RAW" | tail -n 1 || true)
if [ -n "$ENCODE_STATS" ]; then
    echo -e "Último status de envio:\n${YELLOW}$ENCODE_STATS${NC}"
fi

echo ""
echo -e "Peça para seu amigo te enviar o arquivo ${BOLD}${YELLOW}$REPORT${NC} gerado nesta pasta!"
