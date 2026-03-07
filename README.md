# CyberDeck ⚡

A **self-hosted, offline-first communication and survival platform** that transforms any Android phone or Node.js device into a decentralized mesh node. CyberDeck enables real-time messaging, delay-tolerant packet routing, air-gapped data transfer, and peer-to-peer content sharing, all without requiring an internet connection.

When the grid goes down, CyberDeck keeps you connected.

## 📡 Communication & Networking

CyberDeck is built around a multi-layered communication stack that works in any connectivity scenario from full Wi-Fi to complete radio silence.

| Layer | Module | How It Works |
|-------|--------|-------------|
| **Real-time** | 💬 **LAN Chat** | WebSocket-based group chat across all devices on the same network. Zero config, instant join. |
| **Store-and-Forward** | 📡 **DTN Engine** | Delay-Tolerant Networking with automatic **Epidemic Sync** via UDP beacons + mDNS. Devices exchange packets in the background whenever they come within Wi-Fi range, carry data across air-gaps like a physical courier. |
| **Direct Transfer** | 📁 **WebRTC P2P** | Browser-to-browser file transfers over LAN. No server storage touched. |
| **Air-Gapped** | 🕸️ **Mesh Network** | Transmit data with no network at all: **Acoustic MFSK** (audio frequencies), **Optical QR** (camera), or **BLE** (Bluetooth Low Energy). |
| **Content Sharing** | 📦 **LAN Content Sync** | Browse and pull downloaded datasets, models, and knowledge packs directly from nearby CyberDeck nodes over the LAN. License metadata travels with the content. |

### How Devices Communicate

```text
CyberDeck A                          CyberDeck B
┌───────────────┐                   ┌───────────────┐
│ DTN Spool     │◄── Wi-Fi/LAN ────►│ DTN Spool     │
│ Epidemic Sync │   (auto-discover) │ Epidemic Sync │
│               │                   │               │
│ Content Store │◄── LAN Sync ─────►│ Content Store │
│               │                   │               │
│ Mesh Radio    │◄── Audio/QR/BLE ─►│ Mesh Radio    │
└───────────────┘                   └───────────────┘
```

Nodes discover each other automatically via **mDNS** and **UDP Subnet Beacons** (bypasses Android hotspot restrictions). When two CyberDecks come within range, they perform TLS-encrypted background sync — no user action needed.

## 🧠 Knowledge & AI (Offline)

| Module | Description |
|--------|-------------|
| 🤖 **AI Chat** | Chat with local LLMs (Llama 3, Phi-3, Mistral) via Ollama. 100% offline, streaming responses, and **Model List Refresh**. |
| 📚 **Wikipedia** | Offline encyclopedia via Kiwix. Search and read articles without internet. |
| 🗺️ **Maps** | Offline/online maps via Leaflet with geolocation tracking and **Offline Tile Downloader**. |
| 📡 **Nearby** | Auto-discover other CyberDecks on your LAN and **pull content/models offline** from them via specialized P2P protocols. |
| 📖 **Ebooks** | EPUB reader and PDF viewer with saved reading progress. |
| 🛡️ **Survival** | Built-in offline survival guides (Water, Fire, Shelter, First Aid, Navigation). |

## 📦 Content Store & Distribution

CyberDeck includes a built-in store for downloading open-source knowledge packs, AI models, and datasets:

- **Catalog Manifest Architecture** — items defined in `catalog.json`, zero code changes to add content
- **Resumable Downloads** — HTTP Range pause/resume for multi-GB files
- **LAN Content Sync (P2P)** — Share ZIM files and **Ollama AI Models** between devices without internet. Integrated aggregate progress and speed tracking.
- **Cross-Platform Sync** — Seamlessly pull content between Android (Termux), Windows, and Linux.
- **SHA256 Integrity Verification** — post-download hash check, auto-delete corrupted files
- **License Sidecar Files** — `.license.json` accompanies every download with full attribution
- **Attribution Compliance** — all content clearly labeled with license, source, and distributor


## 🎵 Media & Storage

| Module | Description |
|--------|-------------|
| 📁 **Files** | Full file manager with upload/download/delete and **WebRTC P2P Sharing**. |
| 🎵 **Music** | Stream FLAC/MP3/OGG with metadata, album art, visualizer, and persistent queue. |
| 📸 **Photos** | Photo gallery with lazy thumbnails, date grouping, EXIF data, and lightbox viewer. |
| 🎬 **Videos** | Stream videos with range-request seeking and fullscreen support. |
| 🔒 **Vault** | AES-256-GCM encrypted storage. Zero-knowledge — encryption happens in-browser. |

## 🛠️ Utilities

| Module | Description |
|--------|-------------|
| 🧰 **Tools** | Compass, Calculator, Unit Converter, Morse Code generator, Flashlight, Coordinates. |
| 🔋 **Power** | System monitor: CPU load, RAM, storage, battery, temperature, service status. |
| 📱 **PWA** | Progressive Web App, install to home screen, cache UI shell for instant offline loading. |

## 🚀 Quick Start

CyberDeck works on any device running Node.js. Choose your platform:

### Android (via Termux) *Ideal portable mesh node*
```bash
# Install Termux + Termux:API from F-Droid (not Play Store)
pkg update && pkg upgrade
pkg install git Termux:API
git clone https://github.com/sarogamedev/CyberDeck.git
cd CyberDeck/server && bash setup.sh
```

### Linux (Ubuntu/Debian, Fedora, Arch)
```bash
git clone https://github.com/sarogamedev/CyberDeck.git
cd CyberDeck/server && sudo bash setup-linux.sh
```

### Windows (PowerShell)
```powershell
git clone https://github.com/sarogamedev/CyberDeck.git
cd CyberDeck\server
# Run as Administrator
.\setup-windows.ps1
```

### Starting the Server
```bash
node server.js
```

The server displays your LAN IP. Open it on any device on the same network:
- **Client App**: `http://<ip>:8888`
- **Admin Panel**: `http://<ip>:8888/admin`

*(Default credentials: `admin` / `cyberdeck` - change immediately in Admin Panel).*

## 🔌 Admin Panel (`/admin`)

- **Security**: Change access credentials
- **Services**: Start/stop Ollama and Kiwix
- **Library Scanning**: Force rescan media directories
- **Configuration**: Customize directory paths
- **Terminal**: Run shell commands from your browser
- **Metrics**: Real-time performance graphing

## 🏗️ Architecture

```text
Host Device (Termux/PC)                 Client (Any Browser)
┌──────────────────────┐               ┌──────────────────────┐
│  Node.js Server      │               │  CyberDeck SPA       │
│  ├─ Express API      │◄─── Wi-Fi ───►│  ├─ Vanilla JS/CSS   │
│  ├─ DTN Engine       │   (Offline)   │  ├─ WebSockets       │
│  ├─ Content Store    │               │  ├─ WebRTC P2P       │
│  ├─ Ollama (LLMs)    │               │  ├─ Crypto API       │
│  └─ Kiwix (Wiki)     │               │  └─ Service Workers  │
└──────────────────────┘               └──────────────────────┘
```

Built with Vanilla JavaScript, HTML, and CSS — no heavy frameworks. Optimized for maximum performance on low-end devices and rapid loading over local networks.

## 📋 Requirements
- **Host**: Node.js 18+ (Android via Termux, Linux, Windows, macOS)
- **Client**: Any modern web browser
- **Hardware**: Any smartphone from the last 10 years. For **AI Chat**, 6GB+ RAM (8GB recommended)
- **Network**: Wi-Fi router or Mobile Hotspot (no internet required after initial setup)

## 🔧 Third Party Services

CyberDeck integrates with optional external software:

- **[Kiwix](https://www.kiwix.org/)** – Offline Wikipedia server
- **[Ollama](https://ollama.ai/)** – Local AI model runtime

*These services are installed separately and licensed under their respective open-source licenses.*

## 📄 License

MIT License. Build, mod, and survive.

For all open-source libraries used, see [**THIRD_PARTY_LICENSES.md**](THIRD_PARTY_LICENSES.md).

### Third-Party Models and Datasets

CyberDeck allows downloading third-party AI models and datasets via the Store module. These resources are distributed under their respective licenses. CyberDeck does not claim ownership of any downloaded content. Users must comply with the original license terms.
