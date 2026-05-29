# Plan: getprints — CUPS print drop app

**Status:** Draft

## Context

Single-page web app for submitting files to a LAN CUPS server. Drop a PDF or image, pick a printer (populated from CUPS), set options, print. No history, no auth.

## Stack

- **Frontend:** React + Vite + Tailwind + shadcn/ui, Nord dark theme, Inter font
- **Backend:** Node.js + Express, minimal
- **CUPS:** `cups-client` Alpine package → shell out to `lpstat` / `lp`
- **Docker:** single Alpine Node.js container; env vars from `.env`

## Project structure

```
getprints/
  backend/
    index.js          Express server + API routes
    cups.js           lpstat / lp wrappers (execFile, no shell injection)
    package.json
  frontend/
    src/
      App.jsx         root — layout, state, wiring
      components/
        DropZone.jsx       react-dropzone, shows preview after drop
        FilePreview.jsx    iframe (PDF) or img (image)
        ServerStatus.jsx   colored dot + label + refresh button
        PrinterSelect.jsx  populated from GET /api/printers
        PrintOptions.jsx   copies, page range, orientation, scale
    index.html
    vite.config.js    proxy /api → backend in dev
    tailwind.config.js
    package.json
  Dockerfile          multi-stage: build frontend → copy into backend static dir
  docker-compose.yml
  .env                user-edited, not committed
```

## Configuration (.env)

```
CUPS_HOST=192.168.x.x
CUPS_PORT=631
PORT=3000
```

Backend reads `CUPS_HOST` + `CUPS_PORT` (default 631) and combines them as `CUPS_HOST:CUPS_PORT`.

## Backend API

**GET /api/printers**
- Runs: `lpstat -a -h $CUPS_HOST:$CUPS_PORT`
- Parses: first word of each line = printer name
- Returns: `{ok: true, printers: ["HP_LaserJet", ...]}` or `{ok: false, printers: [], error: "unreachable"}`
- Always returns 200; `ok: false` signals server down (frontend shows status accordingly)

**POST /api/analyze** (multipart/form-data)
- Field: `file` (binary)
- Detects orientation from file content:
  - PDF: regex scan on first ~4KB for `/MediaBox [ 0 0 W H ]` — if W > H → landscape, else portrait
  - Image: `image-size` npm package reads header bytes → compare width vs height
- Returns: `{orientation: "portrait"|"landscape"}`
- Called immediately after file drop; sets the orientation default in UI (user can still override)

**POST /api/print** (multipart/form-data)
- Fields: `file` (binary), `printer`, `copies` (int, default 1), `pages` (string, optional — empty = all), `orientation` (portrait|landscape), `scale` (fit|none)
- Backend saves upload to `/tmp` via multer diskStorage
- Builds `lp` args array (execFile — no shell injection):
  ```
  lp -d PRINTER -h CUPS_HOST:CUPS_PORT -n COPIES
     [-P PAGES]                          ← omit entirely if pages empty
     -o orientation-requested=3|4
     -o print-scaling=fit|none
     /tmp/upload-file
  ```
- Cleans up temp file after job submission
- Returns: `{ok: true, jobId}` or `{error: "..."}`

## CUPS option mapping

| UI option | lp flag |
|---|---|
| Copies | `-n N` |
| Page range (empty = all) | `-P 1-N` (omit flag if empty) |
| Portrait | `-o orientation-requested=3` |
| Landscape | `-o orientation-requested=4` |
| Fit to page | `-o print-scaling=fit` |
| 100% | `-o print-scaling=none` |

Collation: default CUPS behavior with `-n` is collated (1-2-3, 1-2-3). No extra flag needed.

## Frontend behavior

1. Drop zone accepts PDF + images only; rejects other types with inline error
2. After drop:
   - Show `FilePreview` (iframe for PDF blob URL, img for image blob URL)
   - POST file to `/api/analyze` → set orientation default from response
   - All options pre-filled with defaults: copies=1, pages="" (all), scale=none, orientation=detected
3. `GET /api/printers` on mount and on refresh:
   - Shows server status indicator: green dot + "Connected" or red dot + "Unreachable"
   - Populates printer select on success; clears it on failure
   - Refresh button (↺) next to status indicator — re-runs the same call manually
   - Disable print button until printer chosen and server is reachable
4. User can override any default before printing
5. Print button → POST to `/api/print` → show success/error inline (no modal)
6. After successful print: reset to empty drop zone, keep printer selection

## Docker

```dockerfile
# Stage 1: build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: backend + cups-client
FROM node:22-alpine
RUN apk add --no-cache cups-client
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "index.js"]
```

docker-compose.yml:
```yaml
services:
  getprints:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
```

## Verification

1. `docker compose build && docker compose up -d`
2. Open `http://localhost:3000`
3. Verify printer list loads (network tab: GET /api/printers returns array)
4. Drop a PDF, check preview renders
5. Set options, hit Print, check CUPS job queue on server: `lpstat -h CUPS_HOST`
