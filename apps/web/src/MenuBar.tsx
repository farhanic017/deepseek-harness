/**
 * Custom menu bar for the Electron desktop app. Replaces the native Win32
 * menu bar (which requires a click before hover effects work on Windows)
 * with a custom HTML/CSS implementation that has immediate hover feedback.
 *
 * Only renders when running inside Electron (window.electronAPI exists).
 * Each menu item opens a dropdown on click; hover effects are immediate
 * via CSS :hover — no activation click needed.
 */
import { useEffect, useRef, useState } from 'react'

/** One dropdown menu entry. */
interface MenuItem {
  label: string
  action?: string
  separator?: boolean
  shortcut?: string
}

/** One top-level menu with its items. */
interface MenuGroup {
  label: string
  items: MenuItem[]
}

declare global {
  interface Window {
    electronAPI?: {
      menu: { action: (action: string) => void }
    }
  }
}

const MENUS: MenuGroup[] = [
  {
    label: 'File',
    items: [
      { label: 'Quit', action: 'quit', shortcut: 'Alt+F4' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', action: 'redo', shortcut: 'Ctrl+Y' },
      { separator: true, label: '' },
      { label: 'Cut', action: 'cut', shortcut: 'Ctrl+X' },
      { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
      { label: 'Paste', action: 'paste', shortcut: 'Ctrl+V' },
      { separator: true, label: '' },
      { label: 'Select All', action: 'selectAll', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Reload', action: 'reload', shortcut: 'Ctrl+R' },
      { label: 'Force Reload', action: 'forceReload', shortcut: 'Ctrl+Shift+R' },
      { label: 'Toggle DevTools', action: 'toggleDevTools', shortcut: 'F12' },
      { separator: true, label: '' },
      { label: 'Zoom In', action: 'zoomIn', shortcut: 'Ctrl+=' },
      { label: 'Zoom Out', action: 'zoomOut', shortcut: 'Ctrl+-' },
      { label: 'Reset Zoom', action: 'resetZoom', shortcut: 'Ctrl+0' },
      { separator: true, label: '' },
      { label: 'Toggle Fullscreen', action: 'toggleFullscreen', shortcut: 'F11' },
    ],
  },
  {
    label: 'Window',
    items: [
      { label: 'Minimize', action: 'minimize', shortcut: 'Alt+Space' },
      { label: 'Close', action: 'close', shortcut: 'Alt+F4' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Documentation', action: 'documentation' },
      { label: 'Report Issue', action: 'reportIssue' },
      { separator: true, label: '' },
      { label: 'About', action: 'about' },
    ],
  },
]

/** Render the custom Electron menu bar. Returns null when not in Electron. */
export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Only render inside Electron.
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
  if (!isElectron) return null

  const send = (action: string): void => {
    window.electronAPI!.menu.action(action)
    setOpenMenu(null)
  }

  // Close dropdown on outside click.
  useEffect(() => {
    if (openMenu === null) return
    const close = (e: MouseEvent): void => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', close, true)
    return () => {
      document.removeEventListener('mousedown', close, true)
    }
  }, [openMenu])

  // Close on Escape.
  useEffect(() => {
    if (openMenu === null) return
    const close = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('keydown', close)
    }
  }, [openMenu])

  return (
    <div ref={barRef} className="electron-menu-bar" role="menubar">
      {MENUS.map((menu) => {
        const isOpen = openMenu === menu.label
        return (
          <div
            key={menu.label}
            className={`electron-menu-item ${isOpen ? 'electron-menu-item-open' : ''}`}
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(menu.label) }}
            role="none"
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className="electron-menu-trigger"
              onClick={() => {
                setOpenMenu(isOpen ? null : menu.label)
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="electron-menu-dropdown" role="menu">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={`sep-${i}`} className="electron-menu-separator" role="separator" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      className="electron-menu-dropdown-item"
                      onClick={() => { if (item.action) send(item.action) }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className="electron-menu-shortcut">{item.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
