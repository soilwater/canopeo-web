// app.js — Canopeo PWA
// Browser port of canopeo_desktop_v1.py with added UI: results table,
// lightbox, color chips, and light/dark theme toggle.

(() => {
'use strict';

// ── Constants ─────────────────────────────────────────────────────────
const VERSION           = '1.0';
const PROC_MAX_SIDE     = 8000;
const DISPLAY_MAX_SIDE  = 800;
const COMPACT_TARGET_PX = 1_000_000;
const THUMB_MAX_SIDE    = 96;   // px — thumbnail size in results table
const LB_MAX_SIDE       = 800;  // px — lightbox image max side

// ── State ─────────────────────────────────────────────────────────────
const state = {
  files:         [],
  currentIndex:  -1,
  resizeMode:    'original',  // 'original' | 'compact'
  ratio:         0.97,
  alpha:         0.35,        // 0..1; slider is 0..100
  noiseReduction: true,
  maskColor:     '#00ff00',   // hex string or 'original'
  current:       null,        // decoded/classified cache for the displayed image
  batchResults:  [],          // row objects for the results table
  pendingCsv:    null,        // { blob, name } — set after batch, downloaded on button click
  pendingZip:    null,        // { blob, name } — set after batch, downloaded on button click
};

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  loadBtn:        $('load-images-btn'),
  loadLabel:      $('load-label'),
  fileInput:      $('file-input'),
  prevBtn:        $('prev-btn'),
  nextBtn:        $('next-btn'),
  ratioSlider:    $('ratio-slider'),
  ratioLabel:     $('ratio-label'),
  alphaSlider:    $('alpha-slider'),
  alphaLabel:     $('alpha-label'),
  noiseCheckbox:  $('noise-reduction-checkbox'),
  imageCounter:   $('image-counter-label'),
  imageName:      $('image-name-label'),
  canopyCover:    $('canopy-cover-label'),
  timestamp:      $('timestamp-label'),
  latitude:       $('latitude-label'),
  longitude:      $('longitude-label'),
  device:         $('device-label'),
  sizeLabel:      $('size-label'),
  mpxLabel:       $('mpx-label'),
  outputTable:    $('output-table'),
  outputBlended:  $('output-blended'),
  outputMask:     $('output-mask'),
  processBtn:     $('process-btn'),
  progressFill:   $('progress-fill'),
  progressLabel:  $('progress-label'),
  canvas:         $('display-canvas'),
  emptyState:     $('empty-state'),
  imageContainer: $('image-container'),
  toast:          $('toast'),
  aboutVersion:   $('about-version'),
  themeToggle:    $('theme-toggle'),
  installBtn:     $('install-btn'),
  resultsSection: $('results-section'),
  resultsBody:    $('results-body'),
  resultsCount:   $('results-count'),
  clearBtn:       $('clear-btn'),
  dlCsvBtn:       $('dl-csv-btn'),
  dlZipBtn:       $('dl-zip-btn'),
  lightbox:       $('lightbox'),
  lightboxImg:    $('lightbox-img'),
  lightboxClose:  $('lightbox-close'),
};

const canvasCtx = dom.canvas.getContext('2d', { willReadFrequently: true });

// ── Theme ─────────────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  dom.themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
  dom.themeToggle.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  try { localStorage.setItem('canopeo-theme', theme); } catch (_) {}
}

function initTheme() {
  let saved;
  try { saved = localStorage.getItem('canopeo-theme'); } catch (_) {}
  const prefersDark = !saved && window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved === 'dark' || prefersDark ? 'dark' : 'light');
}

// ── Helpers ───────────────────────────────────────────────────────────
function basenameNoExt(name) { return name.replace(/\.[^/.]+$/, ''); }

function showToast(msg, isError = false) {
  dom.toast.textContent = msg;
  dom.toast.classList.toggle('error', isError);
  dom.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { dom.toast.hidden = true; }, 4500);
}

function setMpxLabel(mpx) {
  dom.mpxLabel.textContent = ` (${mpx.toFixed(1)} MPx)`;
  dom.mpxLabel.className = mpx < 5 ? 'mpx-low' : mpx < 20 ? 'mpx-mid' : 'mpx-high';
}

function updateNavEnabled() {
  const has = state.files.length > 0;
  dom.prevBtn.disabled = !has;
  dom.nextBtn.disabled = !has;
  dom.processBtn.disabled = !has;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function localStamp() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth()+1) + pad2(d.getDate()) +
         pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1,3), 16),
    parseInt(hex.slice(3,5), 16),
    parseInt(hex.slice(5,7), 16),
  ];
}

// ── EXIF ──────────────────────────────────────────────────────────────
// Reads IFD0 tag 306 (DateTime), Make, Model, and GPS — matching the Python original.

function formatExifDatetime(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4}):(\d{2}):(\d{2})\s(\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : String(raw);
}

function dmsToDecimal(gps, ref) {
  if (!gps || gps.length < 3) return null;
  const dec = Math.round((gps[0] + gps[1]/60 + gps[2]/3600) * 1e6) / 1e6;
  return (ref === 'S' || ref === 'W') ? -dec : dec;
}

/** Strip null bytes, control characters and stray whitespace from EXIF strings.
 *  Camera firmware often null-pads fields: "GoPro\0\0\0" → "GoPro". */
function cleanExifStr(s) {
  if (s === null || s === undefined) return null;
  const cleaned = String(s)
    .replace(/\0/g, '')                    // null bytes
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '') // non-printable / control chars
    .trim();
  return cleaned || null;
}

function readExifAsync(file) {
  return new Promise(resolve => {
    const empty = { make: null, model: '', datetime: null, lat: null, lon: null, alt: null };
    if (typeof EXIF === 'undefined') { resolve(empty); return; }
    try {
      EXIF.getData(file, function() {
        const make  = cleanExifStr(EXIF.getTag(this, 'Make'));
        const model = cleanExifStr(EXIF.getTag(this, 'Model')) ?? '';
        const datetime = formatExifDatetime(EXIF.getTag(this, 'DateTime'));
        const lat = dmsToDecimal(EXIF.getTag(this, 'GPSLatitude'),  EXIF.getTag(this, 'GPSLatitudeRef'));
        const lon = dmsToDecimal(EXIF.getTag(this, 'GPSLongitude'), EXIF.getTag(this, 'GPSLongitudeRef'));
        const altRaw = EXIF.getTag(this, 'GPSAltitude');
        const alt = (altRaw !== undefined && altRaw !== null) ? Math.trunc(Number(altRaw)) : null;
        resolve({ make, model, datetime, lat, lon, alt });
      });
    } catch(_) { resolve(empty); }
  });
}

// ── Classification math ───────────────────────────────────────────────
// Ported directly from canopeo_desktop_v1.py.

function classifyPixels(imageData, ratio) {
  const { data, width, height } = imageData;
  const n = width * height;
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const R = data[o], G = data[o+1], B = data[o+2];
    const R_G = R / G, B_G = B / G;
    const ExG = 2*G - R - B;
    labels[i] = (R_G < ratio && B_G < ratio && ExG > 20) ? 1 : 0;
  }
  return labels;
}

function adaptiveMinSize(w, h) {
  return Math.max(10, Math.floor(Math.max(w,h) * 10 / 800));
}

// 4-connected BFS component labeling; removes components < minSize.
function removeSmallObjects(labels, w, h, minSize) {
  const n = w * h;
  const visited   = new Uint8Array(n);
  const compId    = new Int32Array(n).fill(-1);
  const queue     = new Int32Array(n);
  const sizes     = [];
  let compCount   = 0;

  for (let start = 0; start < n; start++) {
    if (!labels[start] || visited[start]) continue;
    let head = 0, tail = 0, size = 1;
    queue[tail++] = start;
    visited[start] = 1;
    compId[start] = compCount;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w, y = (idx / w) | 0;
      const nb = [x > 0 ? idx-1 : -1, x < w-1 ? idx+1 : -1,
                  y > 0 ? idx-w : -1, y < h-1 ? idx+w : -1];
      for (const ni of nb) {
        if (ni >= 0 && labels[ni] && !visited[ni]) {
          visited[ni] = 1; compId[ni] = compCount; queue[tail++] = ni; size++;
        }
      }
    }
    sizes.push(size);
    compCount++;
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (labels[i] && sizes[compId[i]] >= minSize) out[i] = 1;
  }
  return out;
}

function canopyCoverPct(labels) {
  let sum = 0;
  for (let i = 0; i < labels.length; i++) sum += labels[i];
  return Math.round(sum / labels.length * 1000) / 10;
}

// Build a colored RGBA classified overlay. Background is always opaque black.
// maskColor is a hex string like '#00ff00' or the special string 'original'.
function buildClassifiedImageData(sourceImageData, labels, maskColor) {
  const { data, width, height } = sourceImageData;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const isOrig = maskColor === 'original';
  let mr = 0, mg = 255, mb = 0;
  if (!isOrig) { [mr, mg, mb] = hexToRgb(maskColor); }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o+3] = 255;
    if (!labels[i]) continue; // black background
    if (isOrig) { out[o] = data[o]; out[o+1] = data[o+1]; out[o+2] = data[o+2]; }
    else        { out[o] = mr; out[o+1] = mg; out[o+2] = mb; }
  }
  return new ImageData(out, width, height);
}

function resizeImageData(imageData, targetW, targetH) {
  const src = document.createElement('canvas');
  src.width = imageData.width; src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = targetW; dst.height = targetH;
  const dctx = dst.getContext('2d', { willReadFrequently: true });
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(src, 0, 0, targetW, targetH);
  return dctx.getImageData(0, 0, targetW, targetH);
}

function blendImageData(a, b, alpha) {
  const n = a.data.length;
  const out = new Uint8ClampedArray(n);
  const inv = 1 - alpha;
  for (let o = 0; o < n; o += 4) {
    out[o]   = a.data[o]   * inv + b.data[o]   * alpha;
    out[o+1] = a.data[o+1] * inv + b.data[o+1] * alpha;
    out[o+2] = a.data[o+2] * inv + b.data[o+2] * alpha;
    out[o+3] = 255;
  }
  return new ImageData(out, a.width, a.height);
}

// ── Thumbnail / lightbox image generation ─────────────────────────────
function makeThumbDataUrl(imageData, maxSide, type = 'image/jpeg', quality = 0.78) {
  const { width, height } = imageData;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const src = document.createElement('canvas');
  src.width = width; src.height = height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = tw; dst.height = th;
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
  return dst.toDataURL(type, quality);
}

// ── Image decode / resize ─────────────────────────────────────────────
// Mirrors read_image(): downscale per the Size radio, rotate portrait,
// then build a capped-resolution display copy.

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed.'));
    img.src = url;
  });
}

function drawToCanvas(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

function rotateCanvas90CW(src) {
  const out = document.createElement('canvas');
  out.width = src.height; out.height = src.width;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.translate(src.height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return out;
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImageElement(url); }
  finally { URL.revokeObjectURL(url); }

  let w = img.naturalWidth, h = img.naturalHeight;
  let scale;
  if (state.resizeMode === 'compact') {
    const px = w * h;
    scale = px > COMPACT_TARGET_PX ? Math.sqrt(COMPACT_TARGET_PX / px) : 1;
  } else {
    const longest = Math.max(w, h);
    scale = longest > PROC_MAX_SIDE ? PROC_MAX_SIDE / longest : 1;
  }
  let procW = scale < 1 ? Math.trunc(w * scale) : w;
  let procH = scale < 1 ? Math.trunc(h * scale) : h;

  let procCanvas = drawToCanvas(img, procW, procH);
  if (procH > procW) {
    procCanvas = rotateCanvas90CW(procCanvas);
    [procW, procH] = [procH, procW];
  }

  let dispW, dispH, dispCanvas;
  if (procW > DISPLAY_MAX_SIDE || procH > DISPLAY_MAX_SIDE) {
    const ds = procW > procH ? DISPLAY_MAX_SIDE / procW : DISPLAY_MAX_SIDE / procH;
    dispW = Math.trunc(procW * ds);
    dispH = Math.trunc(procH * ds);
    dispCanvas = drawToCanvas(procCanvas, dispW, dispH);
  } else {
    dispCanvas = procCanvas; dispW = procW; dispH = procH;
  }

  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
  const dispCtx = dispCanvas.getContext('2d', { willReadFrequently: true });
  const exif = await readExifAsync(file);

  return {
    filename: file.name,
    procImageData: procCtx.getImageData(0, 0, procW, procH),
    dispImageData: dispCtx.getImageData(0, 0, dispW, dispH),
    procW, procH, dispW, dispH,
    mpx: (procW * procH) / 1_000_000,
    exif,
  };
}

// ── Core classify → blend → render pipeline ──────────────────────────

function classifyCurrent(updateInfo = true) {
  const c = state.current;
  let labels = classifyPixels(c.procImageData, state.ratio);
  if (state.noiseReduction)
    labels = removeSmallObjects(labels, c.procW, c.procH, adaptiveMinSize(c.procW, c.procH));
  c.labels  = labels;
  c.cover   = canopyCoverPct(labels);

  c.classifiedProc = buildClassifiedImageData(c.procImageData, labels, state.maskColor);
  c.classifiedDisp = (c.procW === c.dispW && c.procH === c.dispH)
    ? c.classifiedProc
    : resizeImageData(c.classifiedProc, c.dispW, c.dispH);

  if (updateInfo) updateInfoPanel(c);
}

// Rebuild overlays without re-thresholding (used when only maskColor changes).
function rebuildClassifiedOnly() {
  const c = state.current;
  if (!c?.labels) return;
  c.classifiedProc = buildClassifiedImageData(c.procImageData, c.labels, state.maskColor);
  c.classifiedDisp = (c.procW === c.dispW && c.procH === c.dispH)
    ? c.classifiedProc
    : resizeImageData(c.classifiedProc, c.dispW, c.dispH);
}

function updateInfoPanel(c) {
  dom.imageCounter.textContent = `${state.currentIndex + 1} / ${state.files.length}`;
  dom.imageName.textContent    = `Filename: ${c.filename}`;
  dom.canopyCover.textContent  = `${c.cover.toFixed(1)}%`;
  dom.timestamp.textContent    = `Timestamp: ${c.exif.datetime ?? 'N/A'}`;
  dom.latitude.textContent     = `Latitude: ${c.exif.lat ?? 'N/A'}`;
  dom.longitude.textContent    = `Longitude: ${c.exif.lon ?? 'N/A'}`;
  const device = [c.exif.make, c.exif.model].filter(v => v && String(v).length).join(' ');
  dom.device.textContent = `Device: ${device || 'N/A'}`;
  dom.sizeLabel.textContent = `Image size: ${c.procW}x${c.procH}`;
  setMpxLabel(c.mpx);
}

function renderBlend() {
  const c = state.current;
  if (!c) return;
  const blended = blendImageData(c.dispImageData, c.classifiedDisp, state.alpha);
  dom.canvas.width = blended.width;
  dom.canvas.height = blended.height;
  canvasCtx.putImageData(blended, 0, 0);
  dom.canvas.classList.add('visible');
  dom.emptyState.style.display = 'none';
}

async function showImage(index) {
  if (!state.files.length) return;
  const i = ((index % state.files.length) + state.files.length) % state.files.length;
  state.currentIndex = i;
  try {
    state.current = await prepareImage(state.files[i]);
  } catch (err) {
    showToast(`Couldn't open "${state.files[i].name}": ${err.message}`, true);
    return;
  }
  classifyCurrent(true);
  renderBlend();
}

// rAF-coalesced reclassify: prevents a backlog on large images when dragging.
let reclassifyHandle = null;
function scheduleReclassify() {
  if (!state.current) return;
  if (reclassifyHandle) cancelAnimationFrame(reclassifyHandle);
  reclassifyHandle = requestAnimationFrame(() => {
    reclassifyHandle = null;
    classifyCurrent(true);
    renderBlend();
  });
}

// ── Clear / reset ─────────────────────────────────────────────────────

function clearResults() {
  state.batchResults = [];
  state.pendingCsv   = null;
  state.pendingZip   = null;
  dom.resultsBody.innerHTML = '';
  dom.resultsCount.textContent = '0';
  dom.resultsSection.hidden = true;
  dom.dlCsvBtn.hidden = true;  dom.dlCsvBtn.disabled = true;
  dom.dlZipBtn.hidden = true;  dom.dlZipBtn.disabled = true;
  dom.progressFill.style.width = '0%';
  dom.progressLabel.textContent = '';
}

function clearAll() {
  state.files = [];
  state.currentIndex = -1;
  state.current = null;
  clearResults();
  dom.canvas.classList.remove('visible');
  dom.emptyState.style.display = '';
  dom.loadLabel.textContent = 'No images loaded';
  dom.imageCounter.textContent = '–';
  dom.imageName.textContent    = 'Filename:';
  dom.canopyCover.textContent  = '–';
  dom.timestamp.textContent    = 'Timestamp:';
  dom.latitude.textContent     = 'Latitude:';
  dom.longitude.textContent    = 'Longitude:';
  dom.device.textContent       = 'Device:';
  dom.sizeLabel.textContent    = 'Image size:';
  dom.mpxLabel.textContent     = '';
  dom.mpxLabel.className       = '';
  updateNavEnabled();
}

// ── Results table ─────────────────────────────────────────────────────

function appendResultRow(r) {
  const fv = v => (v !== null && v !== undefined) ? String(v) : '<span class="null-val">—</span>';
  const fc = v => v !== null ? v.toFixed(5) : '<span class="null-val">—</span>';
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${r.index}</td>
    <td><img class="thumb" src="${r.origThumbUrl}" data-lb="${r.origLbUrl}" title="Click to zoom" /></td>
    <td><img class="thumb" src="${r.maskThumbUrl}" data-lb="${r.maskLbUrl}" title="Click to zoom" /></td>
    <td class="col-cover">${r.cover.toFixed(1)}<span class="pct">%</span></td>
    <td class="col-fn" title="${r.filename}">${r.filename}</td>
    <td class="hide-sm">${fv(r.datetime)}</td>
    <td class="hide-sm">${fc(r.lat)}</td>
    <td class="hide-sm">${fc(r.lon)}</td>
  `;
  tr.querySelectorAll('[data-lb]').forEach(img =>
    img.addEventListener('click', () => openLightbox(img.dataset.lb))
  );
  dom.resultsBody.appendChild(tr);
}

// ── Lightbox ──────────────────────────────────────────────────────────

function openLightbox(url) {
  dom.lightboxImg.src = url;
  dom.lightbox.classList.add('open');
}

function closeLightbox() {
  dom.lightbox.classList.remove('open');
  setTimeout(() => { dom.lightboxImg.src = ''; }, 300);
}

// ── Batch export helpers ──────────────────────────────────────────────

function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc  = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n') + '\n';
}

function imageDataToBlob(imageData, type, quality) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise(res => c.toBlob(res, type, quality));
}

// ── Batch processing ──────────────────────────────────────────────────

async function processBatch() {
  const wantTable   = dom.outputTable.checked;
  const wantBlended = dom.outputBlended.checked;
  const wantMask    = dom.outputMask.checked;

  if (!wantTable && !wantBlended && !wantMask) {
    showToast('Select at least one output type.', true); return;
  }
  if (!state.files.length) return;

  dom.processBtn.disabled = true;
  clearResults(); // reset table before this batch run

  const csvRows  = [];
  const zip      = (wantBlended || wantMask) ? new JSZip() : null;
  const saved    = state.currentIndex;
  const n        = state.files.length;

  try {
    for (let i = 0; i < n; i++) {
      const pct = Math.round(i / n * 100);
      dom.progressFill.style.width = pct + '%';
      dom.progressLabel.textContent = `Progress: ${pct} %`;

      let img;
      try { img = await prepareImage(state.files[i]); }
      catch (_) { continue; } // skip unreadable files

      let labels = classifyPixels(img.procImageData, state.ratio);
      if (state.noiseReduction)
        labels = removeSmallObjects(labels, img.procW, img.procH, adaptiveMinSize(img.procW, img.procH));
      const cover    = canopyCoverPct(labels);
      const baseName = basenameNoExt(img.filename);

      // Build display-res classified overlay for thumbnails
      const classProc = buildClassifiedImageData(img.procImageData, labels, state.maskColor);
      const classDisp = (img.procW === img.dispW && img.procH === img.dispH)
        ? classProc
        : resizeImageData(classProc, img.dispW, img.dispH);

      // Thumbnails for results table
      const origThumbUrl = makeThumbDataUrl(img.dispImageData, THUMB_MAX_SIDE);
      const maskThumbUrl = makeThumbDataUrl(classDisp,         THUMB_MAX_SIDE);
      // Larger versions for the lightbox (use display res — already ≤800px)
      const origLbUrl = makeThumbDataUrl(img.dispImageData, LB_MAX_SIDE, 'image/jpeg', 0.88);
      const maskLbUrl = makeThumbDataUrl(classDisp,         LB_MAX_SIDE, 'image/jpeg', 0.88);

      // Append row to the live table
      const result = {
        index: state.batchResults.length + 1,
        cover, filename: img.filename,
        datetime: img.exif.datetime, lat: img.exif.lat, lon: img.exif.lon,
        origThumbUrl, maskThumbUrl, origLbUrl, maskLbUrl,
      };
      state.batchResults.push(result);
      appendResultRow(result);
      dom.resultsCount.textContent = String(state.batchResults.length);
      if (state.batchResults.length === 1) dom.resultsSection.hidden = false;

      // CSV row — exact column order matches canopeo_desktop_v1.py's metadata dict
      if (wantTable) {
        csvRows.push({
          file_name: img.filename, mpx: img.mpx,
          image_size: `${img.procW}x${img.procH}`,
          canopy_cover: cover,
          latitude: img.exif.lat, longitude: img.exif.lon, altitude: img.exif.alt,
          device_maker: img.exif.make, device_model: img.exif.model,
          image_timestamp: img.exif.datetime,
        });
      }

      // ZIP entries
      if (zip) {
        if (wantMask) {
          // Boolean mask: white = canopy, black = background
          const n2 = img.procW * img.procH;
          const mdata = new Uint8ClampedArray(n2 * 4);
          for (let j = 0; j < n2; j++) {
            const v = labels[j] ? 255 : 0;
            mdata[j*4] = mdata[j*4+1] = mdata[j*4+2] = v; mdata[j*4+3] = 255;
          }
          const maskBlob = await imageDataToBlob(new ImageData(mdata, img.procW, img.procH), 'image/png');
          zip.file(`mask_${baseName}.png`, maskBlob);
        }
        if (wantBlended) {
          const blended    = blendImageData(img.procImageData, classProc, state.alpha);
          const blendedBlob = await imageDataToBlob(blended, 'image/jpeg', 0.75);
          zip.file(`blended_${baseName}.jpg`, blendedBlob);
        }
      }

      // Yield to keep the progress bar painting
      await new Promise(r => setTimeout(r, 0));
    }

    dom.progressLabel.textContent = 'Building outputs\u2026';
    await new Promise(r => setTimeout(r, 0));

    const stamp = localStamp();
    if (wantTable && csvRows.length) {
      state.pendingCsv = { blob: new Blob([toCSV(csvRows)], { type: 'text/csv;charset=utf-8' }), name: `Canopeo_${stamp}.csv` };
    }
    if (zip) {
      state.pendingZip = { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), name: `Canopeo_${stamp}.zip` };
    }

    // Always show both buttons; disable the ones with no data so the user
    // can see they exist without wondering why a click does nothing.
    dom.dlCsvBtn.hidden    = false;
    dom.dlCsvBtn.disabled  = !state.pendingCsv;
    dom.dlCsvBtn.title     = state.pendingCsv ? 'Download CSV' : 'Enable "Table (CSV)" before processing to generate this';
    dom.dlZipBtn.hidden    = false;
    dom.dlZipBtn.disabled  = !state.pendingZip;
    dom.dlZipBtn.title     = state.pendingZip ? 'Download ZIP' : 'Enable "Blended JPEGs" or "Boolean masks" before processing to generate this';

    dom.progressFill.style.width = '100%';
    dom.progressLabel.textContent = 'Done — click CSV or ZIP to download.';

    // Scroll to results table after batch completes
    if (state.batchResults.length)
      setTimeout(() => dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);

  } catch (err) {
    showToast(`Batch failed: ${err.message}`, true);
  } finally {
    dom.processBtn.disabled = false;
    if (state.files.length) await showImage(saved);
    setTimeout(() => {
      dom.progressFill.style.width = '0%';
      dom.progressLabel.textContent = '';
    }, 5000);
  }
}

// ── File loading ──────────────────────────────────────────────────────

async function loadFiles(fileList) {
  const files = Array.from(fileList).filter(
    f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif)$/i.test(f.name)
  );
  if (!files.length) return;
  clearResults(); // new image set → old results are stale
  state.files = files;
  dom.loadLabel.textContent = `${files.length} image${files.length === 1 ? '' : 's'} loaded`;
  updateNavEnabled();
  await showImage(0);
}

// ── Event wiring ──────────────────────────────────────────────────────

// Load / file input
dom.loadBtn.addEventListener('click',  () => dom.fileInput.click());
dom.fileInput.addEventListener('change', () => {
  loadFiles(dom.fileInput.files).catch(err => showToast(err.message, true));
  dom.fileInput.value = '';
});

// Drag & drop on the image pane
['dragenter','dragover'].forEach(evt =>
  dom.imageContainer.addEventListener(evt, e => { e.preventDefault(); dom.imageContainer.classList.add('drag-over'); })
);
['dragleave','drop'].forEach(evt =>
  dom.imageContainer.addEventListener(evt, e => {
    if (evt === 'drop') { e.preventDefault(); }
    dom.imageContainer.classList.remove('drag-over');
  })
);
dom.imageContainer.addEventListener('drop', e => {
  if (e.dataTransfer?.files?.length)
    loadFiles(e.dataTransfer.files).catch(err => showToast(err.message, true));
});

// Click canvas → open lightbox
dom.canvas.addEventListener('click', () => {
  if (!dom.canvas.classList.contains('visible')) return;
  openLightbox(dom.canvas.toDataURL('image/jpeg', 0.9));
});

// Prev / Next
dom.prevBtn.addEventListener('click', () => showImage(state.currentIndex - 1).catch(err => showToast(err.message, true)));
dom.nextBtn.addEventListener('click', () => showImage(state.currentIndex + 1).catch(err => showToast(err.message, true)));

// Ratio slider
dom.ratioSlider.addEventListener('input', () => {
  state.ratio = Math.round(parseFloat(dom.ratioSlider.value) * 100) / 100;
  dom.ratioLabel.textContent = `Ratio: ${state.ratio.toFixed(2)}`;
  scheduleReclassify();
});

// Alpha slider (blend-only — no reclassify needed)
dom.alphaSlider.addEventListener('input', () => {
  const pct = parseInt(dom.alphaSlider.value, 10);
  state.alpha = pct / 100;
  dom.alphaLabel.textContent = `Blended opacity: ${pct}`;
  renderBlend();
});

// Noise reduction
dom.noiseCheckbox.addEventListener('change', () => {
  state.noiseReduction = dom.noiseCheckbox.checked;
  scheduleReclassify();
});

// Color chips
document.querySelectorAll('.color-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.maskColor = chip.dataset.color;
    rebuildClassifiedOnly();
    renderBlend();
  });
});

// Resize mode radios
document.querySelectorAll('input[name="resize-mode"]').forEach(r =>
  r.addEventListener('change', () => {
    if (!r.checked) return;
    state.resizeMode = r.value;
    if (state.currentIndex >= 0) showImage(state.currentIndex).catch(err => showToast(err.message, true));
  })
);

// Process batch
dom.processBtn.addEventListener('click', () => processBatch().catch(err => showToast(err.message, true)));

// Clear
dom.clearBtn.addEventListener('click', clearAll);

// Download buttons — triggered explicitly by the user after batch completes
dom.dlCsvBtn.addEventListener('click', () => { if (state.pendingCsv) saveAs(state.pendingCsv.blob, state.pendingCsv.name); });
dom.dlZipBtn.addEventListener('click', () => { if (state.pendingZip) saveAs(state.pendingZip.blob, state.pendingZip.name); });

// Lightbox close
dom.lightbox.addEventListener('click', e => { if (e.target === dom.lightbox) closeLightbox(); });
dom.lightboxClose.addEventListener('click', closeLightbox);

// ── Help menu / modals ────────────────────────────────────────────────

const helpBtn = $('help-menu-btn');
helpBtn.addEventListener('click', e => { e.stopPropagation(); helpBtn.classList.toggle('open'); });
document.addEventListener('click', () => helpBtn.classList.remove('open'));

const openModal  = id => $(id).classList.add('open');
const closeModal = el => el.closest('.modal-overlay').classList.remove('open');

$('menu-about').addEventListener('click',   () => { helpBtn.classList.remove('open'); openModal('about-modal');   });
$('menu-guide').addEventListener('click',   () => { helpBtn.classList.remove('open'); openModal('guide-modal');   });
$('menu-license').addEventListener('click', () => { helpBtn.classList.remove('open'); openModal('license-modal'); });

document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn)));
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (dom.lightbox.classList.contains('open')) { closeLightbox(); return; }
    document.querySelectorAll('.modal-overlay.open').forEach(o => o.classList.remove('open'));
  }
});

// ── Theme toggle ───────────────────────────────────────────────────────

dom.themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(cur === 'dark' ? 'light' : 'dark');
});

// ── PWA install prompt ────────────────────────────────────────────────

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  dom.installBtn.hidden = false;
});
dom.installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  dom.installBtn.hidden = true;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
});
window.addEventListener('appinstalled', () => { dom.installBtn.hidden = true; });

// ── Service worker ────────────────────────────────────────────────────

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));

// ── Init ──────────────────────────────────────────────────────────────

initTheme();
dom.aboutVersion.textContent = VERSION;
updateNavEnabled();

// Load the three bundled demo images so users can explore immediately.
// Fails silently if the demo/ folder is absent (e.g., stripped for deployment).
(async () => {
  const paths = ['demo/demo_1.jpg', 'demo/demo_2.jpg', 'demo/demo_3.jpg'];
  try {
    const files = (await Promise.all(paths.map(async p => {
      const r = await fetch(p);
      if (!r.ok) return null;
      return new File([await r.blob()], p.split('/').pop(), { type: 'image/jpeg' });
    }))).filter(Boolean);
    if (files.length) {
      await loadFiles(files);
      dom.loadLabel.textContent = `${files.length} demo images loaded`;
    }
  } catch (_) { /* demo images unavailable — user loads their own */ }
})();

})();
