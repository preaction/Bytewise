
// Initialize electron-store
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const os = require('os');

contextBridge.exposeInMainWorld('electron', {
  isMac: os.platform() === "darwin",
  isWindows: os.platform() === "win32",
  isLinux: os.platform() === "linux",
  store: {
    get(file:string, val:string, def:any) {
      return ipcRenderer.sendSync('electron-store-get', file, val, def);
    },
    set(file:string, property:string, val:any) {
      ipcRenderer.send('electron-store-set', file, property, val);
    },
    // Other method you want to add like has(), reset(), etc.
  },
  resourcesPath():Promise<string> {
    return ipcRenderer.invoke('bytewise-resources-path');
  },
  // Any other methods you want to expose in the window object.
  // ...
  openProject() {
    return ipcRenderer.invoke('bytewise-open-project');
  },
  newProject() {
    return ipcRenderer.invoke('bytewise-new-project');
  },
  readProject( path:string ) {
    return ipcRenderer.invoke('bytewise-read-project', path);
  },
  readFile( path:string ) {
    return ipcRenderer.invoke('bytewise-read-file', path);
  },
  newFile( path:string, name:string, ext:string, data:any ) {
    return ipcRenderer.invoke('bytewise-new-file', path, name, ext, data);
  },
  saveFile( path:string, data:any ) {
    return ipcRenderer.invoke('bytewise-save-file', path, data);
  },
  on( channel:string, cb:(...args:any[])=>void ) {
    return ipcRenderer.on( channel, cb );
  },
  removeListener( channel:string, cb:(...args:any[])=>void ) {
    return ipcRenderer.removeListener( channel, cb );
  },
  deleteTree( root:string, path:string ) {
    return ipcRenderer.invoke('bytewise-delete-tree', root, path);
  },
  renamePath( root:string, path:string, to:string ) {
    return ipcRenderer.invoke('bytewise-rename-path', root, path, to);
  },
  buildProject( root:string, src:string, dest:string ) {
    return ipcRenderer.invoke('bytewise-build-project', root, src, dest);
  },
  openEditor( root:string, file:string ) {
    return ipcRenderer.invoke('bytewise-open-editor', root, file);
  },
});


function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = ev => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)