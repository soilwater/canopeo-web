# Canopeo — Progressive Web App

A browser port of **Canopeo Desktop** that replicates the desktop app's two-pane layout and classification pipeline as a standalone Progressive Web App (PWA). Everything — image decoding, classification, noise reduction, and file packaging — runs locally in the browser via Canvas 2D APIs; no images are uploaded anywhere.

---

## Features

- Same classification algorithm as the desktop app: `R/G < ratio`, `B/G < ratio`, `2G − R − B > 20`
- Ratio slider (0.85–1.15), blended-opacity slider, noise reduction, three mask colors (Neon / White / Original)
- Batch processing: exports a CSV table, blended JPEGs, and/or boolean-mask PNGs packaged in a ZIP
- Drag-and-drop or click-to-browse file loading
- Help menu with About, User Guide, and License dialogs matching the desktop app
- Installable as a PWA (Chrome / Edge / Safari on iOS 16.4+) for an offline, app-like experience

---

## Testing locally

The service worker requires an `http://` or `https://` origin — it won't register over a plain `file://` URL. Spin up any static server from the project root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or with Node:

```bash
npx serve .
# then open the URL it prints
```

The app itself (canvas processing, file downloads) works fine without the service worker, so you can also just open `index.html` directly in a browser for quick testing — offline caching just won't be active.

---

## Deploying

The entire project is a folder of static files — no build step, no backend. Upload it as-is to any static host:

| Host | Notes |
|---|---|
| **GitHub Pages** | Push to a repo, enable Pages in Settings → Pages |
| **Netlify** | Drag the folder onto netlify.com/drop |
| **Vercel** | `vercel` CLI or import the repo |
| **Cloudflare Pages** | Connect repo or drag-and-drop in the dashboard |

**HTTPS is required** for full PWA installability (the "Install App" button). All the hosts above provide HTTPS automatically. `localhost` is treated as secure by browsers, so local testing works without it.

---

## Optional: institutional logos in the About dialog

The About dialog has placeholder `<img>` tags for the K-State and OSU logos. They're hidden automatically if the files don't exist. To show them, drop these files into the `assets/` folder:

- `assets/kstate_logo.jpg` — Kansas State University wordmark
- `assets/osu_logo.png` — Oklahoma State University wordmark

---

## File structure

```
canopeo-pwa/
├── index.html            Main shell — layout, modals, static guide/license text
├── styles.css            Styling that mirrors the ttk/Tkinter desktop look
├── app.js                All application logic (classification, batch export, UI wiring)
├── manifest.webmanifest  PWA manifest (icons, display mode, theme color)
├── service-worker.js     App-shell cache-first offline strategy
├── LICENSE.txt           PolyForm Noncommercial License 1.0.0
├── icons/
│   ├── icon-192.png      PWA home-screen icon
│   ├── icon-256.png      Source icon copy
│   ├── icon-512.png      PWA splash / store icon
│   ├── favicon-32.png    Browser tab favicon
│   └── favicon-16.png    Browser tab favicon (small)
├── vendor/
│   ├── exif.js           exif-js 2.3.0 (MIT) — EXIF metadata extraction
│   ├── jszip.min.js      JSZip 3.10.1 (MIT/GPLv3) — in-browser ZIP generation
│   └── FileSaver.js      FileSaver.js (X11/MIT) — browser download helper
└── assets/               Optional institutional logos (see above)
```

---

## Intentional divergences from the desktop app

| Behavior | Desktop app | This web app |
|---|---|---|
| Output directory | User picks a folder via a system dialog | No folder picker — outputs download automatically via the browser |
| Boolean-mask PNGs | True single-channel grayscale (PIL `mode='L'`) | RGBA with R=G=B (Canvas2D always writes 4 channels); visually identical, file slightly larger |
| JPEG resampling | PIL LANCZOS | Canvas2D `imageSmoothingQuality: 'high'` — minor quality difference at display scale only |
| Large-image lag | Slider drags lag on `>20 MPx` images at Original size | Same expected behavior — not artificially capped |
| Demo images | Three bundled `.jpg` files ship with the desktop installer | No bundled demos — user loads their own images |

---

## Reference

Patrignani, A., & Ochsner, T. E. (2015). Canopeo: A powerful new tool for measuring fractional green canopy cover. *Agronomy Journal*, 107(6), 2312–2320. https://doi.org/10.2134/agronj15.0150

---

## License

PolyForm Noncommercial License 1.0.0 — see `LICENSE.txt`.
