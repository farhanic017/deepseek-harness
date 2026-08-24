import { contextBridge, ipcRenderer } from 'electron'

// Inject the custom menu bar HTML/CSS into the page before React mounts.
// This replaces the native Win32 menu bar (which requires a click before
// hover effects work on Windows) with a custom HTML/CSS implementation.
function injectMenuBar(): void {
  if (document.getElementById('electron-menu-bar-injected')) return

  const style = document.createElement('style')
  style.textContent = `
    .electron-menu-bar {
      display: flex; align-items: center; height: 28px; padding: 0 4px;
      background: #1e1e2e; border-bottom: 1px solid #313244;
      font-size: 13px; line-height: 1; color: #cdd6f4;
      user-select: none; -webkit-app-region: drag; z-index: 9999; flex-shrink: 0;
    }
    .electron-menu-item { position: relative; }
    .electron-menu-trigger {
      display: flex; align-items: center; height: 24px; padding: 0 8px;
      border: none; border-radius: 4px; background: transparent; color: inherit;
      font: inherit; cursor: pointer; -webkit-app-region: no-drag;
    }
    .electron-menu-trigger:hover, .electron-menu-item-open .electron-menu-trigger {
      background: rgba(255, 255, 255, 0.08);
    }
    .electron-menu-trigger:focus-visible {
      outline: 1px solid #89b4fa; outline-offset: -1px;
    }
    .electron-menu-dropdown {
      position: absolute; top: 100%; left: 0; min-width: 200px; padding: 4px;
      border: 1px solid #313244; border-radius: 8px; background: #1e1e2e;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); z-index: 10000;
      -webkit-app-region: no-drag;
    }
    .electron-menu-dropdown-item {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; gap: 24px; padding: 6px 10px; border: none; border-radius: 6px;
      background: transparent; color: #cdd6f4; font: inherit; font-size: 13px;
      line-height: 20px; text-align: left; cursor: pointer; white-space: nowrap;
    }
    .electron-menu-dropdown-item:hover { background: #313244; }
    .electron-menu-dropdown-item:focus-visible {
      outline: 1px solid #89b4fa; outline-offset: -1px;
    }
    .electron-menu-shortcut { font-size: 12px; color: #6c7086; }
    .electron-menu-separator { height: 1px; margin: 4px 8px; background: #313244; }
    html, body { margin: 0; padding: 0; }
    body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #root { flex: 1; overflow: auto; }
  `
  document.head.appendChild(style)

  const menuBar = document.createElement('div')
  menuBar.className = 'electron-menu-bar'
  menuBar.setAttribute('role', 'menubar')
  menuBar.id = 'electron-menu-bar-injected'

  const MENUS = [
    { label: 'File', items: [
      { label: 'Quit', action: 'quit', shortcut: 'Alt+F4' },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', action: 'undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', action: 'redo', shortcut: 'Ctrl+Y' },
      { separator: true },
      { label: 'Cut', action: 'cut', shortcut: 'Ctrl+X' },
      { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
      { label: 'Paste', action: 'paste', shortcut: 'Ctrl+V' },
      { separator: true },
      { label: 'Select All', action: 'selectAll', shortcut: 'Ctrl+A' },
    ] },
    { label: 'View', items: [
      { label: 'Reload', action: 'reload', shortcut: 'Ctrl+R' },
      { label: 'Force Reload', action: 'forceReload', shortcut: 'Ctrl+Shift+R' },
      { label: 'Toggle DevTools', action: 'toggleDevTools', shortcut: 'F12' },
      { separator: true },
      { label: 'Zoom In', action: 'zoomIn', shortcut: 'Ctrl+=' },
      { label: 'Zoom Out', action: 'zoomOut', shortcut: 'Ctrl+-' },
      { label: 'Reset Zoom', action: 'resetZoom', shortcut: 'Ctrl+0' },
      { separator: true },
      { label: 'Toggle Fullscreen', action: 'toggleFullscreen', shortcut: 'F11' },
    ] },
    { label: 'Window', items: [
      { label: 'Minimize', action: 'minimize', shortcut: 'Alt+Space' },
      { label: 'Close', action: 'close', shortcut: 'Alt+F4' },
    ] },
    { label: 'Help', items: [
      { label: 'Documentation', action: 'documentation' },
      { label: 'Report Issue', action: 'reportIssue' },
      { separator: true },
      { label: 'About', action: 'about' },
    ] },
  ]

  let openMenu: string | null = null
  let hoverTimer: number | undefined
  let closeTimer: number | undefined

  // Hover opens a menu after this long; switching to another trigger while a
  // menu is open is immediate, and leaving the bar closes after the grace
  // period so the pointer can reach the dropdown without it closing.
  const HOVER_DELAY_MS = 150
  const CLOSE_GRACE_MS = 250

  function clearHoverTimer(): void {
    if (hoverTimer !== undefined) { clearTimeout(hoverTimer); hoverTimer = undefined }
  }

  function clearCloseTimer(): void {
    if (closeTimer !== undefined) { clearTimeout(closeTimer); closeTimer = undefined }
  }

  function closeAll(): void {
    clearHoverTimer()
    clearCloseTimer()
    openMenu = null
    menuBar.querySelectorAll('.electron-menu-item').forEach((el) => {
      el.classList.remove('electron-menu-item-open')
      const dd = el.querySelector('.electron-menu-dropdown')
      if (dd) dd.remove()
    })
  }

  // Drop any open dropdown and mount the given menu's items below its trigger.
  function openMenuFor(menu: { label: string; items: any[] }, item: HTMLElement): void {
    clearHoverTimer()
    clearCloseTimer()
    if (openMenu === menu.label) return
    menuBar.querySelectorAll('.electron-menu-item-open').forEach((el) => {
      el.classList.remove('electron-menu-item-open')
      const dd = el.querySelector('.electron-menu-dropdown')
      if (dd) dd.remove()
    })
    openMenu = menu.label
    item.classList.add('electron-menu-item-open')
    const dd = document.createElement('div')
    dd.className = 'electron-menu-dropdown'
    dd.setAttribute('role', 'menu')
    menu.items.forEach((mi: any) => {
      if (mi.separator) {
        const sep = document.createElement('div')
        sep.className = 'electron-menu-separator'
        sep.setAttribute('role', 'separator')
        dd.appendChild(sep)
      } else {
        const miBtn = document.createElement('button')
        miBtn.type = 'button'
        miBtn.className = 'electron-menu-dropdown-item'
        miBtn.setAttribute('role', 'menuitem')
        const span = document.createElement('span')
        span.textContent = mi.label
        miBtn.appendChild(span)
        if (mi.shortcut) {
          const sc = document.createElement('span')
          sc.className = 'electron-menu-shortcut'
          sc.textContent = mi.shortcut
          miBtn.appendChild(sc)
        }
        miBtn.addEventListener('click', () => {
          closeAll()
          ipcRenderer.send('menu:action', mi.action)
        })
        dd.appendChild(miBtn)
      }
    })
    item.appendChild(dd)
  }

  MENUS.forEach((menu) => {
    const item = document.createElement('div')
    item.className = 'electron-menu-item'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'electron-menu-trigger'
    btn.textContent = menu.label
    // Click toggles the menu; hover opens it (delayed on the first open,
    // immediate when switching between open menus).
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (openMenu === menu.label) { closeAll(); return }
      openMenuFor(menu, item)
    })
    btn.addEventListener('mouseenter', () => {
      if (openMenu !== null && openMenu !== menu.label) {
        openMenuFor(menu, item)
      } else if (openMenu === null) {
        clearCloseTimer()
        clearHoverTimer()
        hoverTimer = window.setTimeout(() =>{  openMenuFor(menu, item) }, HOVER_DELAY_MS)
      }
    })
    // Leaving a trigger cancels its pending hover-open (another trigger's
    // enter will schedule its own); an open menu stays open until the pointer
    // leaves the whole bar or picks another trigger.
    btn.addEventListener('mouseleave', clearHoverTimer)
    item.appendChild(btn)
    menuBar.appendChild(item)
  })

  // Close once the pointer leaves the bar (grace period covers the trip into
  // the dropdown, which sits outside the bar's box). Re-entering cancels.
  menuBar.addEventListener('mouseover', clearCloseTimer)
  menuBar.addEventListener('mouseout', (e) => {
    if (e.relatedTarget instanceof Node && menuBar.contains(e.relatedTarget)) return
    clearCloseTimer()
    closeTimer = window.setTimeout(closeAll, CLOSE_GRACE_MS)
  })

  document.addEventListener('click', closeAll)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll() })
  window.addEventListener('blur', closeAll)

  // Insert at the very top of the page, before #root.
  document.body.insertBefore(menuBar, document.body.firstChild)
}

// Run immediately when preload executes (before DOMContentLoaded).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMenuBar)
} else {
  injectMenuBar()
}

const electronAPI = {
  dsh: {
    getPort: () => ipcRenderer.invoke('dsh:get-port'),
    onReady: (callback: (data: { port: number; url: string }) => void) => {
      ipcRenderer.on('dsh:ready', (_event, data) =>{  callback(data) })
      return () => ipcRenderer.off('dsh:ready', (_event, data) =>{  callback(data) })
    },
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
    saveFile: (options: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:save-file', options),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPath: (name: string) => ipcRenderer.invoke('app:get-path', name),
  },
  menu: {
    action: (action: string) =>{  ipcRenderer.send('menu:action', action) },
  },
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development',
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
