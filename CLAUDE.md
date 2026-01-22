# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build      # Full build: TypeScript compile + bundle renderer + copy assets
npm start          # Build and run the app (with 8GB heap)
npm run dev        # Development mode with TypeScript watch + Electron
npm run dist       # Package for distribution
```

The build process:
1. `tsc` compiles TypeScript from `src/` to `dist/`
2. `esbuild` bundles the renderer process JS for the browser
3. Assets (HTML, CSS) are copied to `dist/renderer/`

## Architecture

This is an Electron app with a clear main/renderer process split:

### Main Process (`src/main/`)
- **index.ts** - App entry point, window management, power assertion
- **scanner/FileScanner.ts** - Recursive filesystem scanning with depth/children limits
- **scanner/VolumeDetector.ts** - Volume detection and monitoring via `diskutil`
- **database/Database.ts** - SQLite wrapper for scan history and preferences
- **duplicate/HashWorker.ts** - Duplicate file detection using partial MD5 hashing
- **file-ops/** - Trash and secure delete operations
- **ipc/handlers.ts** - All IPC handlers between main and renderer

### Renderer Process (`src/renderer/`)
- **components/App.ts** - Main app orchestrator, initializes all components and handles rendering
- **state/store.ts** - Simple state management with subscriber pattern
- **visualizations/** - D3.js visualizations (Treemap, Sunburst, BarChart, ColumnView, Timeline)

### Shared (`src/shared/`)
- **types.ts** - TypeScript interfaces used by both processes
- **categories.ts** - File categorization by extension

### IPC Communication
- Main process exposes API via `src/preload/preload.ts` using contextBridge
- Renderer accesses via `window.storageMap.*`
- Scan results stream via IPC events (`scan:progress`, `scan:batch`, `scan:complete`)

## Key Constraints

- **Memory limits**: Scanner limits depth (MAX_DEPTH=10), children per directory (1000), and excludes system paths to prevent OOM
- **Visualization limits**: Treemap limits to 2000 nodes, Sunburst to 1500 arcs to maintain performance
- **Duplicate detection**: Uses partial hashing (first/last 4KB) for files, limits to 50,000 files max

## CSS

Single stylesheet at `src/renderer/styles/main.css` with CSS variables for theming. Supports system light/dark mode via `prefers-color-scheme`.
