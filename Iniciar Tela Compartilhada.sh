#!/bin/bash
# ==============================================================================
# Tela Compartilhada - Inicializador Automático para Linux
# Executa a versão nativa sem precisar de Wine, Proton ou Faugus Launcher.
# Se o .AppImage ainda não existir, baixa automaticamente a versão mais recente.
# ==============================================================================
set -e
cd "$(dirname "$0")"

APPIMAGE="./TelaCompartilhada.AppImage"
REPO="AlexWBMaya/tela-compartilhada"

# 1. Se o AppImage não estiver na pasta, baixa a versão mais recente do GitHub
if [ ! -f "$APPIMAGE" ]; then
    echo "=========================================================="
    echo "Baixando Tela Compartilhada para Linux pela primeira vez..."
    echo "=========================================================="

    DOWNLOAD_URL=""
    if command -v curl >/dev/null 2>&1; then
        DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep -o 'https://[^"]*TelaCompartilhada[^"]*\.AppImage' | head -n 1 || true)
        if [ -z "$DOWNLOAD_URL" ]; then
            DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep -o 'https://[^"]*\.AppImage' | head -n 1 || true)
        fi
    elif command -v wget >/dev/null 2>&1; then
        DOWNLOAD_URL=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep -o 'https://[^"]*TelaCompartilhada[^"]*\.AppImage' | head -n 1 || true)
    fi

    if [ -n "$DOWNLOAD_URL" ]; then
        echo "Baixando de: $DOWNLOAD_URL"
        if command -v curl >/dev/null 2>&1; then
            curl -L "$DOWNLOAD_URL" -o "$APPIMAGE" --progress-bar
        elif command -v wget >/dev/null 2>&1; then
            wget -O "$APPIMAGE" "$DOWNLOAD_URL" --show-progress
        fi
    fi
fi

# 2. Se o AppImage foi encontrado ou baixado, executa nativamente
if [ -f "$APPIMAGE" ]; then
    chmod +x "$APPIMAGE"
    echo "Iniciando Tela Compartilhada..."
    exec "$APPIMAGE" "$@"
fi

# 3. Fallback: se estiver na pasta do código-fonte com Node.js
if [ -f "package.json" ]; then
    echo "Modo desenvolvedor: iniciando via Electron local..."
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    exec npx electron . "$@"
fi

echo "=========================================================="
echo "Erro: Não foi possível baixar o TelaCompartilhada.AppImage."
echo "Verifique sua conexão ou acesse https://github.com/$REPO/releases"
echo "=========================================================="
read -p "Pressione Enter para fechar..."
