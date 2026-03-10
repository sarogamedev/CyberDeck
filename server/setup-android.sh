#!/data/data/com.termux/files/usr/bin/bash

# ╔═══════════════════════════════════════════════════════╗
# ║           CyberDeck - Termux Setup Script             ║
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

# ── Storage Permission ──
step "Requesting storage permission..."
if [ ! -d ~/storage ]; then
    termux-setup-storage
    sleep 2
    success "Storage permission granted"
else
    success "Storage already accessible"
fi

# ── Update packages ──
step "Updating Termux packages..."
pkg update -y && pkg upgrade -y || warn "Failed to update packages, but continuing..."
success "Packages updated"

# ── Core dependencies ──
step "Installing core dependencies..."
pkg install -y nodejs-lts git ffmpeg python || warn "Failed to install some dependencies. Ensure node is installed."
success "Core dependencies installed"

# ── Navigate to project ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if running from /sdcard (doesn't support symlinks)
if echo "$SCRIPT_DIR" | grep -q '/storage/emulated'; then
    warn "Project is on /sdcard which doesn't support symlinks."
    echo "  Copying project to Termux home directory for compatibility..."
    DEST="$HOME/CyberDeck/server"
    mkdir -p "$HOME/CyberDeck"
    cp -r "$(dirname "$SCRIPT_DIR")/server" "$HOME/CyberDeck/"
    cp -r "$(dirname "$SCRIPT_DIR")/client" "$HOME/CyberDeck/"
    cp "$(dirname "$SCRIPT_DIR")/README.md" "$HOME/CyberDeck/" 2>/dev/null
    SCRIPT_DIR="$DEST"
    success "Project copied to $HOME/CyberDeck"
    echo "  ➤ Run the server from: ${BOLD}$DEST${NC}"
fi
cd "$SCRIPT_DIR"

# ── NPM Install ──
step "Installing Node.js dependencies..."
npm install --no-bin-links
success "Node.js dependencies installed"

# ── Create cache directory ──
step "Setting up cache directories..."
mkdir -p .cache/thumbnails
success "Cache directories created"

# ── Optional: Install Ollama ──
step "Setting up Ollama (Local LLM)..."
if command -v ollama &> /dev/null; then
    success "Ollama already installed"
else
    warn "Ollama not found. Attempting install..."
    if pkg install -y ollama 2>/dev/null; then
        success "Ollama installed"
    else
        warn "Ollama auto-install failed."
        echo "  To install manually, run:"
        echo "    curl -fsSL https://ollama.com/install.sh | sh"
        echo "  Or install via pkg if available for your architecture."
    fi
fi

# ── Optional: Install Kiwix ──
step "Setting up Kiwix (Offline Wikipedia)..."
if command -v kiwix-serve &> /dev/null; then
    success "Kiwix already installed"
else
    warn "Kiwix not found. Attempting install..."
    if pkg install -y kiwix-tools 2>/dev/null; then
        success "Kiwix installed"
    else
        warn "Kiwix auto-install failed."
        echo "  To install manually:"
        echo "    pkg install kiwix-tools"
        echo "  Download a .zim file from: https://wiki.kiwix.org/wiki/Content"
    fi
fi

# ── Summary ──
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  CyberDeck setup complete!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  Start the server with:"
echo -e "    ${BOLD}node server.js${NC}"
echo ""
echo -e "  Then open in your browser:"
echo -e "    ${BOLD}http://<your-phone-ip>:8888${NC}"
echo ""
echo -e "  Admin panel:"
echo -e "    ${BOLD}http://<your-phone-ip>:8888/admin${NC}"
echo ""

# ── Optional: Pull a small LLM model ──
read -p "Would you like to pull a small LLM model (tinyllama, ~637MB)? [y/N]: " pull_model
if [[ "$pull_model" =~ ^[Yy]$ ]]; then
    step "Pulling tinyllama model..."
    ollama pull tinyllama
    success "Model downloaded"
fi

echo -e "\n${MAGENTA}CyberDeck is ready to go!${NC}\n"
