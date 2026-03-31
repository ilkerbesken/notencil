const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const url = require('url');

let authServer;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets/favicon/favicon.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  // win.webContents.openDevTools(); // Geliştirme aşamasında konsolu açmak isterseniz
}

// Google OAuth IPC handler
ipcMain.handle('google-auth', async (event, { clientId, scopes }) => {
  return new Promise((resolve, reject) => {
    if (authServer) authServer.close();

    authServer = http.createServer(async (req, res) => {
      try {
        const query = url.parse(req.url, true).query;
        if (query.code) {
          res.end('Yetkilendirme basarili! Bu pencereyi kapatabilirsiniz.');
          authServer.close();
          authServer = null;
          
          // Exchange code for token (we need to do this from main or renderer)
          // For simplicity, we'll return the code to renderer
          resolve({ code: query.code, redirectUri: `http://localhost:${authServer.address().port}` });
        } else {
          res.end('Yetkilendirme kodu bulunamadi.');
          reject(new Error('Yetkilendirme kodu bulunamadi.'));
        }
      } catch (err) {
        reject(err);
      }
    });

    authServer.listen(0, '127.0.0.1', () => {
      const port = authServer.address().port;
      const redirectUri = `http://localhost:${port}`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
      
      shell.openExternal(authUrl);
    });
  });
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');

// Google OAuth IPC handler
ipcMain.handle('google-auth', async (event, { clientId, scopes }) => {
  return new Promise((resolve, reject) => {
    if (authServer) {
        authServer.close();
        authServer = null;
    }

    authServer = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url, true);
        
        // Google implicit flow returns token in hash fragment (#access_token=...)
        // But hash fragments are not sent to the server. 
        // We'll serve a small JS that extracts the hash and sends it back to us via query param.
        if (parsedUrl.pathname === '/callback') {
            res.end(`
                <html>
                <body>
                    <p>Yetkilendirme tamamlaniyor, lütfen bekleyin...</p>
                    <script>
                        const params = new URLSearchParams(window.location.hash.substring(1));
                        const accessToken = params.get('access_token');
                        if (accessToken) {
                            window.location.href = '/done?access_token=' + accessToken;
                        } else {
                            document.body.innerHTML = 'Yetkilendirme hatasi: Token bulunamadi.';
                        }
                    </script>
                </body>
                </html>
            `);
            return;
        }

        if (parsedUrl.pathname === '/done') {
            const accessToken = parsedUrl.query.access_token;
            if (accessToken) {
                res.end('Yetkilendirme basarili! Bu pencereyi kapatabilir ve uygulamaya dönebilirsiniz.');
                resolve({ access_token: accessToken });
            } else {
                res.end('Yetkilendirme hatasi: Access Token eksik.');
                reject(new Error('Access Token eksik.'));
            }
            if (authServer) {
                authServer.close();
                authServer = null;
            }
            return;
        }

        res.end('Gecersiz istek.');
      } catch (err) {
        reject(err);
      }
    });

    authServer.listen(0, '127.0.0.1', () => {
      const port = authServer.address().port;
      const redirectUri = `http://localhost:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${encodeURIComponent(scopes)}`;
      
      shell.openExternal(authUrl);
    });
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
