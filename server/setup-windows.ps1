param(
    [switch]$Help
)

# ╔═══════════════════════════════════════════════════════╗
# ║          CyberDeck - Windows Setup Script             ║
# ║    One-click installer for all server components      ║
# ╚═══════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

function Print-Banner {
    Write-Host ""
    Write-Host "  ╔═════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║   ██████╗██╗   ██╗██████╗ ███████╗██████╗   ║" -ForegroundColor Cyan
    Write-Host "  ║  ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗  ║" -ForegroundColor Cyan
    Write-Host "  ║  ██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝  ║" -ForegroundColor Cyan
    Write-Host "  ║  ██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗  ║" -ForegroundColor Cyan
    Write-Host "  ║  ╚██████╗   ██║   ███████║███████╗██║  ██║  ║" -ForegroundColor Cyan
    Write-Host "  ║   ╚═════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝  ║" -ForegroundColor Cyan
    Write-Host "  ║            D E C K   S E R V E R            ║" -ForegroundColor Cyan
    Write-Host "  ╚═════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Step([string]$message) {
    Write-Host ""
    Write-Host "[⚡] $message" -ForegroundColor Magenta
}

function Success([string]$message) {
    Write-Host "[✓] $message" -ForegroundColor Green
}

function Warn([string]$message) {
    Write-Host "[!] $message" -ForegroundColor Yellow
}

function Fail([string]$message) {
    Write-Host "[✗] $message" -ForegroundColor Red
}

Print-Banner

# Check for Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Warn "This script should be run as Administrator to install Chocolatey and global dependencies."
    Write-Host "  If you already have Node.js, Git, and FFmpeg installed, you can proceed."
    $response = Read-Host "  Continue anyway? (y/N)"
    if ($response -notmatch "^y$|^Y$") {
        exit
    }
}

Step "Checking core dependencies (Node.js, Git, FFmpeg)..."

# Install Chocolatey if needed
if (-not (Get-Command "choco" -ErrorAction SilentlyContinue)) {
    if ($isAdmin) {
        Warn "Chocolatey not found. Installing..."
        Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        refreshenv
        Success "Chocolatey installed"
    } else {
        Fail "Cannot install Chocolatey without Administrator privileges. Please install Node.js, Git, and FFmpeg manually."
    }
} else {
    Success "Chocolatey (package manager) found"
}

# Install dependencies via Chocolatey
$deps = @("nodejs", "git", "ffmpeg")
foreach ($dep in $deps) {
    if (-not (Get-Command $dep -ErrorAction SilentlyContinue)) {
        if ($isAdmin) {
            Write-Host "  Installing $dep via chocolatey..."
            choco install $dep -y
        } else {
            Warn "  $dep is not installed and script lacks Administrator privileges. Please install manually."
        }
    } else {
        Success "Dependency found: $dep"
    }
}

Step "Installing Node.js dependencies..."
$scriptPath = $PSScriptRoot
Set-Location -Path $scriptPath

try {
    npm install
    Success "Node.js dependencies installed"
} catch {
    Fail "Failed to install Node.js dependencies"
}

Step "Setting up cache directories..."
if (-not (Test-Path ".cache\thumbnails")) {
    New-Item -ItemType Directory -Path ".cache\thumbnails" | Out-Null
}
if (-not (Test-Path "downloads")) {
    New-Item -ItemType Directory -Path "downloads" | Out-Null
}
Success "Cache directories created"

Step "Configuring Windows Firewall..."
try {
    if ($isAdmin) {
        Write-Host "  Opening ports 8888 (HTTP) and 8443 (HTTPS) in Windows Firewall..."
        New-NetFirewallRule -DisplayName "CyberDeck Server (TCP In)" -Direction Inbound -LocalPort 8888,8443 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
        New-NetFirewallRule -DisplayName "CyberDeck Beacons (UDP In)" -Direction Inbound -LocalPort 8888,5353 -Protocol UDP -Action Allow -ErrorAction SilentlyContinue | Out-Null
        Success "Windows Firewall rules added for CyberDeck"
    } else {
        Warn "Cannot configure firewall without Administrator privileges. You may receive a prompt or blocks."
    }
} catch {
    Warn "Failed to configure Windows Firewall. Please ensure ports 8888 and 8443 are manually opened."
}

Step "Setting up Ollama (Local LLM)..."
if (Get-Command "ollama" -ErrorAction SilentlyContinue) {
    Success "Ollama already installed"
} else {
    Warn "Ollama not found. Downloading installer..."
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile "OllamaSetup.exe"
    Write-Host "  Running OllamaSetup.exe. Please follow the installation prompts."
    Start-Process -FilePath "OllamaSetup.exe" -Wait
    Success "Ollama installation completed (you may need to restart your terminal for 'ollama' command to work)"
}

Step "Setting up Kiwix (Offline Wikipedia)..."
if (Get-Command "kiwix-serve" -ErrorAction SilentlyContinue) {
    Success "Kiwix already installed globally"
} elseif (Test-Path "kiwix-serve.exe") {
    Success "Kiwix already downloaded locally"
} else {
    Warn "Kiwix not found. Downloading kiwix-tools for Windows..."
    try {
        # Note: Using a specific known good version since Kiwix doesn't have a static "latest" URL for Windows tools
        $kiwixUrl = "https://download.kiwix.org/release/kiwix-tools/kiwix-tools_win-i686-3.7.0-2.zip"
        $zipPath = "kiwix-tools.zip"
        
        Write-Host "  Downloading $kiwixUrl..."
        Invoke-WebRequest -Uri $kiwixUrl -OutFile $zipPath
        
        Write-Host "  Extracting kiwix-serve.exe..."
        Expand-Archive -Path $zipPath -DestinationPath "kiwix-temp" -Force
        
        # Find the exe inside the extracted folder structure
        $exePath = Get-ChildItem -Path "kiwix-temp" -Filter "kiwix-serve.exe" -Recurse | Select-Object -First 1
        if ($exePath) {
            Move-Item -Path $exePath.FullName -Destination ".\kiwix-serve.exe" -Force
            Success "Kiwix installed successfully to local directory"
        } else {
            Fail "Could not find kiwix-serve.exe in the downloaded archive"
        }
        
        # Cleanup
        Remove-Item "kiwix-temp" -Recurse -Force
        Remove-Item $zipPath -Force
    } catch {
        Warn "Failed to auto-download Kiwix. You can download it manually from:"
        Write-Host "  https://download.kiwix.org/release/kiwix-tools/"
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  CyberDeck Windows setup complete! " -ForegroundColor Green -NoNewline
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Start the server with:"
Write-Host "    node server.js" -ForegroundColor White
Write-Host ""
Write-Host "  Then open in your browser:"
Write-Host "    http://localhost:8888" -ForegroundColor White
Write-Host ""
Write-Host "CyberDeck is ready to go!" -ForegroundColor Magenta
Write-Host ""
