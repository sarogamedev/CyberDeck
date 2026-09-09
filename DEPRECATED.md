# Deprecated distributions

CyberDeck is a **server you reach from a browser**. That is the supported way to
use it on every platform.

Three packaged distributions used to be documented in the README. They are no
longer built from this branch:

| Distribution | Last documented version | Status |
|---|---|---|
| CyberDeck Server (native Android app) | `CyberDeck_Server_V1.0.5.apk` | Deprecated, unmaintained |
| CyberDeck Client (native Android app) | `CyberDeck_Client_V1.0.0.apk` | Deprecated, unmaintained |
| CyberDeck Desktop (packaged Windows `.exe`) | built via electron-builder | Packaging removed |

Existing builds remain downloadable from the
[Releases](https://github.com/sarogamedev/CyberDeck/releases) page, and the
Android application sources live on their own branches. They are kept for people
already running them. They do not receive fixes, including security fixes.

> **Security note.** Builds published before the hardening work on this branch
> are affected by the issues that work fixed, among them an unauthenticated
> arbitrary file write reachable from any host on the same network, an
> unauthenticated arbitrary file read, and a vault whose encryption key was
> recoverable from the metadata file stored beside the ciphertext. Treat any
> earlier APK or `.exe` as unsafe on a network you do not control.

## What is still here

Nothing about running CyberDeck changed. The server runs on Android via Termux,
Linux, Windows and macOS, and any device on the network opens the UI in a
browser. See the Quick Start section of [README.md](README.md).

The **Electron desktop window is still supported** and still runs from source:

```bash
npm run setup   # installs the desktop shell and the server
npm start       # opens the desktop window
```

It starts the server as a child process and loads the same browser UI, so it is
a convenience wrapper, not a separate application.

## What was removed

Only the packaging pipeline, because its output belongs in Releases rather than
in the repository:

- the `electron-builder` dependency
- the `build` block in `package.json` that defined the portable Windows `.exe`
  target, `asar: false`, and the `extraResources` entry for `kiwix-serve.exe`
- the `npm run build` script

The old build instructions were:

```powershell
# 1. Complete the Windows PowerShell setup first
# 2. From the repository root
npm install
# 3. Build the portable executable into dist/
npm run build
```

Removing the packaging step also let the root `package.json` shed the runtime
dependencies it duplicated from `server/package.json`; they existed only so
electron-builder could bundle them. `electron-main.js` requires nothing but
`electron` and Node builtins, and it forks the server with `cwd` set to
`server/`, so the server resolves its own dependencies. The root lockfile went
from 461 packages to 71.

To restore packaging, add `electron-builder` back as a dev dependency and
recover the `build` block from history:

```bash
git log --oneline -- package.json
git show <commit-before-removal>:package.json
```

## Native Android apps

The Android sources were never part of this branch. `.gitignore` still excludes
`CyberDeckClient/` and `CyberDeckServerApp/`, along with `*.apk` and `*.jks`, so
a local checkout of those projects cannot be committed here by accident.

The old install instructions were:

**Server app** — download `CyberDeck_Server_V1.0.5.apk` from Releases, install,
launch, tap **START SERVER**. The app bundled its own Node.js runtime and
handled asset extraction.

**Client app** — download `CyberDeck_Client_V1.0.0.apk` from Releases, install,
launch. It scanned the Wi-Fi network for nearby nodes and connected on tap.

Both are replaced by running the server (Termux on Android) and opening the UI
in a browser.
