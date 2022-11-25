import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron'
import { release } from 'os'
import * as path from 'path'
import * as esbuild from 'esbuild';

// Initialize electron-store
import Store from 'electron-store'
ipcMain.on('electron-store-get', async (event, file, val, def) => {
  const store = new Store({ name: file });
  event.returnValue = store.get(val, def);
});
ipcMain.on('electron-store-set', async (event, file, key, val) => {
  const store = new Store({ name: file });
  store.set(key, val);
});

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

export const ROOT_PATH = {
  // /dist
  dist: path.join(__dirname, '../..'),
  // /dist or /public
  public: path.join(__dirname, app.isPackaged ? '../..' : '../../../public'),
}

let win: BrowserWindow | null = null
// Here, you can also use other preload
const preload = path.join(__dirname, '../preload/index.js')
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin
const url = `http://${process.env['VITE_DEV_SERVER_HOST']}:${process.env['VITE_DEV_SERVER_PORT']}`
const indexHtml = path.join(ROOT_PATH.dist, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'Main window',
    icon: path.join(ROOT_PATH.public, 'favicon.ico'),
    webPreferences: {
      preload,
    },
  })

  if (app.isPackaged) {
    win.loadFile(indexHtml)
  } else {
    win.loadURL(url)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// new window example arg: new windows url
ipcMain.handle('open-win', (event, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
    },
  })

  if (app.isPackaged) {
    childWindow.loadFile(indexHtml, { hash: arg })
  } else {
    childWindow.loadURL(`${url}/#${arg}`)
    // childWindow.webContents.openDevTools({ mode: "undocked", activate: true })
  }
})

ipcMain.handle('bytewise-open-project', event => {
  if ( !win ) {
    return;
  }
  return dialog.showOpenDialog(win, {
    filters: [],
    properties: [ 'openDirectory', 'createDirectory' ],
  });
});

ipcMain.handle('bytewise-new-project', event => {
  if ( !win ) {
    return;
  }
  return dialog.showSaveDialog(win, {
    defaultPath: 'New Project',
    filters: [],
    properties: [ 'createDirectory' ],
  })
  .then(
    (res) => {
      if ( res.filePath ) {
        // XXX: What to do if directory exists?
        return fs.mkdir(res.filePath).then(() => res);
      }
      return res
    },
  );
});

type projectFile = {
  name: string,
  ext: string,
  path: string,
  isDirectory: boolean,
  children?: projectFile[],
};

async function descend( filePath:string, root:string='' ):Promise<projectFile[]> {
  if ( root == '' ) {
    root = filePath;
    filePath = '';
  }
  return fs.readdir( path.join(root, filePath), { withFileTypes: true })
  .then( async (paths) => {
    return Promise.all(
      paths.map( async p => {
        const ext = p.isFile() ? p.name.substring( p.name.lastIndexOf( '.' ) ) : '';
        const item:projectFile = {
          name: p.name.substring( 0, p.name.length - ext.length ),
          ext,
          path: path.join( filePath, p.name ),
          isDirectory: false,
        };
        if ( p.isDirectory() ) {
          item.isDirectory = true;
          item.children = await descend( item.path, root );
        }
        return item;
      })
    );
  });
}

let aborter:AbortController;
ipcMain.handle('bytewise-read-project', (event, path) => {
  if ( !win ) {
    return;
  }
  if ( aborter ) {
    aborter.abort();
  }
  aborter = new AbortController();

  const watcher = fs.watch( path, { signal: aborter.signal, recursive: true, persistent: false } );
  (async () => {
    try {
      for await (const event of watcher) {
        console.log( 'got watcher event', event );
        win.webContents.send( 'watch', event );
      }
    }
    catch ( err:any ) {
      if (err.name === 'AbortError') {
        return;
      }
      throw err;
    }
  })();
  return descend(path);
});

// Register a protocol to allow reading files from the project root
protocol.registerSchemesAsPrivileged([
  { scheme: 'bfile', privileges: { standard: true, supportFetchAPI: true, bypassCSP: true } }
]);
app.whenReady().then(() => {
  protocol.registerFileProtocol('bfile', (request, callback) => {
    const url = request.url.substr(8);
    callback({ path: path.normalize(`${url}`) });
  })
})

ipcMain.handle('bytewise-new-file', ( event, root, name, ext, data ) => {
  if ( !win ) {
    return;
  }
  console.log( 'bytewise-new-file', root, name, ext, data );
  // XXX: Ensure extension on filename
  return dialog.showSaveDialog(win, {
    defaultPath: path.join( root, name ),
    filters: [ { name: ext, extensions: [ext] } ],
    properties: [ 'createDirectory' ],
  })
  .then(
    (res) => {
      if ( res.filePath ) {
        if ( !res.filePath.match( "\\." + ext + "$" ) ) {
          res.filePath += '.' + ext;
        }
        // XXX: Write to new file then rename to avoid losing data
        return fs.writeFile( res.filePath, data ).then( () => res );
      }
      return res
    },
  );
});

ipcMain.handle('bytewise-save-file', (event, path, data) => {
  // XXX: Write to new file then rename to avoid losing data
  return fs.writeFile( path, data );
});

ipcMain.handle('bytewise-read-file', (event, path) => {
  return fs.readFile( path, { encoding: 'utf8' } );
});

ipcMain.handle('bytewise-delete-tree', (event, root, tree) => {
  return fs.rm( path.join( root, tree ), { recursive: true } );
});

ipcMain.handle('bytewise-rename-path', (event, root, from, to) => {
  return fs.rename( path.join( root, from ), path.join( root, to ) );
});

ipcMain.handle('bytewise-build-project', async (event, root, src, dest) => {
  if ( !win ) {
    return;
  }
  const webwin = win;
  const modulesDir = path.resolve( __dirname.replace( 'app.asar', '' ), '../../../node_modules' );

  // Check for typescript errors
  const tsc = path.resolve( modulesDir, 'typescript/bin/tsc' );
  const cp = fork( tsc, [ '--noEmit' ], {
    cwd: root,
    stdio: 'overlapped',
  } );
  cp.stderr?.on( 'data', (buf) => webwin.webContents.send('error', buf.toString()) );
  cp.stdout?.on( 'data', (buf) => webwin.webContents.send('log', buf.toString()) );
  cp.on('error', (err) => {
    webwin.webContents.send( 'error', err );
  } );

  return esbuild.build({
    nodePaths: [
      // This provides bundled libraries like 'bitecs', 'three', and
      // 'Ammo'
      modulesDir,
    ],
    bundle: true,
    define: { Ammo: '{ "ENVIRONMENT": "WEB" }' },
    external: [
      // Ammo.js can run in Node, but esbuild tries to resolve these
      // Node modules even if we are going to run in the browser.
      'fs', 'path',
    ],
    absWorkingDir: root,
    entryPoints: [src],
    outfile: dest,
    outbase: root,
    format: 'esm',
    sourcemap: true,
  });

  return;
});

ipcMain.handle('bytewise-open-editor', (event, root, file) => {
  return shell.openPath(path.join(root, file));
});

ipcMain.handle('bytewise-resources-path', (event) => {
  const resourcesPath = path.resolve( __dirname.replace( 'app.asar', '' ), '../../..' );
  return resourcesPath;
});