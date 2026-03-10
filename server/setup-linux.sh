#!/bin/bash

# ╔═══════════════════════════════════════════════════════╗
# ║           CyberDeck - Linux Setup Script              ║
# ║     One-click installer for all server components     ║
# ╚═══════════════════════════════════════════════════════╝

set -e

CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

print_banner() {
    echo -e "${CYAN}"
    echo "  ╔═════════════════════════════════════════════╗"
    echo "  ║   ██████╗██╗   ██╗██████╗ ███████╗██████╗   ║"
    echo "  ║  ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗  ║"
    echo "  ║  ██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝  ║"
    echo "  ║  ██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗  ║"
    echo "  ║  ╚██████╗   ██║   ███████║███████╗██║  ██║  ║"
    echo "  ║   ╚═════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝  ║"
    echo "  ║            D E C K   S E R V E R            ║"
    echo "  ╚═════════════════════════════════════════════╝"
    echo -e "${NC}"
}

step() {
    echo -e "\n${MAGENTA}[⚡]${NC} ${BOLD}$1${NC}"
}

success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_banner

# Require sudo for package installation
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root or use sudo (e.g., sudo bash setup-linux.sh)"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    error "Cannot detect OS"
    exit 1
fi

step "Updating package lists..."
if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    apt-get update -y
elif [[ "$OS" == "fedora" || "$OS" == "centos" ]]; then
    dnf check-update || true
elif [[ "$OS" == "arch" ]]; then
    pacman -Sy --noconfirm
else
    warn "Unsupported OS for automatic package installation. Please install Node.js, git, and ffmpeg manually."
fi

step "Installing core dependencies (Node.js, git, ffmpeg)..."
if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs git ffmpeg curl
elif [[ "$OS" == "fedora" || "$OS" == "centos" ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    dnf install -y nodejs git ffmpeg curl
elif [[ "$OS" == "arch" ]]; then
    pacman -S --noconfirm nodejs npm git ffmpeg curl
fi
success "Core dependencies installed"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

step "Installing Node.js packages..."
npm install
success "Node.js dependencies installed"

step "Setting up cache & download directories..."
mkdir -p .cache/thumbnails
mkdir -p downloads
success "Directories created"

step "Setting up Ollama (Local LLM)..."
if command -v ollama &> /dev/null; then
    success "Ollama already installed"
else
    warn "Ollama not found. Attempting install..."
    curl -fsSL https://ollama.com/install.sh | sh
    success "Ollama installed"
fi

step "Setting up Kiwix (Offline Wikipedia)..."
if command -v kiwix-serve &> /dev/null; then
    success "Kiwix already installed"
else
    warn "Kiwix not found. Attempting install via flatpak or snap..."
    if command -v flatpak &> /dev/null; then
        flatpak install -y flathub org.kiwix.desktop
        success "Kiwix installed via Flatpak (note: kiwix-serve binary might need manual path linking)"
    elif command -v snap &> /dev/null; then
        snap install kiwix-desktop
        success "Kiwix installed via Snap"
    else
        warn "Could not auto-install Kiwix-serve. Please download static binaries from https://kiwix.org/en/download/"
    fi
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  CyberDeck Linux setup complete!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  Start the server with:"
echo -e "    ${BOLD}node server.js${NC}"
echo ""
echo -e "  Then open in your browser:"
echo -e "    ${BOLD}http://localhost:8888${NC} or ${BOLD}http://<your-ip>:8888${NC}"
echo ""

echo -e "\n${MAGENTA}CyberDeck is ready to go!${NC}\n"
