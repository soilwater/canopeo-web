# Canopeo — Progressive Web App

A browser port of **Canopeo Desktop** that replicates the desktop app's two-pane layout and classification pipeline as a standalone Progressive Web App (PWA). Everything — image decoding, classification, noise reduction, and file packaging — runs locally in the browser. No images are uploaded anywhere.

---

## Features

- Same classification algorithm as the desktop app: `R/G < ratio`, `B/G < ratio`, `2G − R − B > 20`
- Ratio slider (0.85–1.15), blended-opacity slider, noise reduction, three mask colors (Neon / White / Original)
- Batch processing: exports a CSV table, blended JPEGs, and/or boolean-mask PNGs packaged in a ZIP
- Drag-and-drop or click-to-browse file loading
- Help menu with About, User Guide, and License dialogs matching the desktop app
- Installable as a PWA (Chrome / Edge / Safari on iOS 16.4+) for offline use

The browser has limited storage and processing of large or many images can be slower than the desktop version.

---

## Reference

Patrignani, A., & Ochsner, T. E. (2015). Canopeo: A powerful new tool for measuring fractional green canopy cover. *Agronomy Journal*, 107(6), 2312–2320. https://doi.org/10.2134/agronj15.0150

---

## License

PolyForm Noncommercial License 1.0.0 — see `LICENSE.txt`.
