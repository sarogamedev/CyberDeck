const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#000000',
        title: 'CyberDeck OS',
        icon: path.join(__dirname, 'CD Logo No Text.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webviewTag: false
        }
    });

    // Hide menu bar for a cleaner "OS" look
    mainWindow.setMenuBarVisibility(false);

    // The page renders content that arrives from LAN peers, so keep the window
    // pinned to the local app and push anything else out to the real browser.
    const isAppUrl = (target) => {
        try {
            const url = new URL(target);
            return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
                   (url.protocol === 'http:' || url.protocol === 'https:');
        } catch (err) {
            return false;
        }
    };

    mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (!isAppUrl(targetUrl)) {
            event.preventDefault();
            shell.openExternal(targetUrl).catch(() => { });
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Never spawn a child BrowserWindow: it would inherit webPreferences.
        if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => { });
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });

    // In production, we point to the local server
    // During startup, we might need to wait for the server to be ready
    const serverUrl = 'http://127.0.0.1:8888';

    const startLoading = () => {
        mainWindow.loadURL(serverUrl).catch(() => {
            console.log('Server not ready, retrying...');
            setTimeout(startLoading, 500);
        });
    };

    startLoading();

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

function startServer() {
    const serverScript = path.join(__dirname, 'server', 'server.js');
    const serverCwd = path.join(__dirname, 'server');

    // Resolve a persistent Data Home in the user's Documents folder
    // This ensures data persists across portable app launches/updates.
    const dataHome = path.join(app.getPath('documents'), 'CyberDeck');

    // Use fork with ELECTRON_RUN_AS_NODE to use the bundled Node engine natively.
    // This prevents a system terminal window from popping up.
    serverProcess = fork(serverScript, [], {
        cwd: serverCwd,
        env: { 
            ...process.env, 
            ELECTRON_RUN_AS_NODE: '1',
            CYBERDECK_DATA_HOME: dataHome,
            // Serve the full API over loopback HTTP for this window only; the
            // LAN-facing listener stays HTTPS.
            CYBERDECK_LOCAL_HTTP: '1'
        },
        stdio: 'ignore' // Suppress stdio to ensure no terminal interactions
    });

    serverProcess.on('error', (err) => {
        console.error('Failed to start server child process:', err);
    });

    serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code ${code}`);
        if (mainWindow && code !== 0 && code !== null) {
            const { dialog } = require('electron');
            dialog.showErrorBox("CyberDeck Server Error", `The background server process crashed unexpectedly with code ${code}.`);
            app.quit();
        }
    });
}

app.on('ready', () => {
    startServer();
    createWindow();
});

app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    if (serverProcess) {
        console.log('Shutting down CyberDeck server...');
        serverProcess.kill();
    }
});
