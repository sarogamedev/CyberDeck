# Deprecated distributions

CyberDeck is a **server you reach from a browser**. That is the supported way to
use it on every platform.

Three packaged distributions used to be documented in the README. They are no
longer built from this branch:

| Distribution | Last documented version | Status |
|---|---|---|
| CyberDeck Server (native Android app) | `CyberDeck_Server_V1.0.5.apk` | Deprecated, unmaintained |
| CyberDeck Client (native Android app) | `CyberDeck_Client_V1.0.0.apk` | Deprecated, unmaintained |
| CyberDeck Desktop (Electron shell and packaged `.exe`) | built via electron-builder | Removed |

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

Everything. CyberDeck is a server you open in a browser, and none of the removed
distributions were required for that:

- the server runs on Android via Termux, Linux, Windows and macOS
- any device on the network opens the UI in a browser
- on the machine running it, `http://localhost:8888` serves the app directly

See the Quick Start section of [README.md](README.md).

## What was removed

### Electron desktop shell and Windows packaging

`electron-main.js`, the `electron` and `electron-builder` dependencies, the
`build` block defining the portable `.exe` target, the `npm run build` script,
and the root `package-lock.json`.

The shell did three things: fork `server/server.js`, set two environment
variables, and open a window pointed at `http://localhost:8888`. A browser tab
does the same thing, so it was a wrapper rather than a feature. Nothing in
`server/` or `client/` ever referenced Electron.

The old build instructions were:

```powershell
# 1. Complete the Windows PowerShell setup first
# 2. From the repository root
npm install
# 3. Build the portable executable into dist/
npm run build
# 4. Or run without building
npm start
```

`npm start` at the repository root now starts the server.

Removing the shell also emptied the root `package.json`. Nothing at the
repository root executes any more, so the runtime dependencies it duplicated
from `server/package.json` went with it, along with the root lockfile that
pinned 461 packages. `server/` owns its dependencies and its own lockfile.

One behaviour the shell provided is now built in. It set `CYBERDECK_LOCAL_HTTP`
so the window could load the app over loopback without accepting a self-signed
certificate. The HTTP listener now makes that decision per request: loopback
clients are served the app directly, and everyone else is redirected to HTTPS.
Local browsing needs no certificate prompt, and credentials still never cross
the network in the clear.

To restore the shell, recover it from history:

```bash
git log --oneline -- electron-main.js
git checkout <commit-before-removal> -- electron-main.js package.json
```

Two icon files at the repository root, `CD Logo New.png` and
`CD Logo No Text.png`, were the Electron window icon and are now unreferenced by
any code. They are left in place as project branding; the client has its own
`client/img/logo.png`.

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
