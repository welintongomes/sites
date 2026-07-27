'use strict';
/* ===================================================================
   MEUS SITES — acervo pessoal
   App 100% local: nenhuma chamada de rede é feita por este arquivo.
   Armazenamento em IndexedDB. Cada site guardado é renderizado dentro
   de um <iframe sandbox> sem "allow-same-origin", isolando totalmente
   o CSS/HTML/JS de cada site do restante do app (e de outros sites).
   =================================================================== */

/* ----------------------------- DB layer ----------------------------- */

const DB_NAME = 'MeusSitesVaultDB';
const DB_VERSION = 1;
let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sites')) {
        db.createObjectStore('sites', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        const fs = db.createObjectStore('files', { keyPath: 'fid', autoIncrement: true });
        fs.createIndex('bySite', 'siteId', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function dbGetAllSites() {
  const db = await openDatabase();
  const tx = db.transaction('sites', 'readonly');
  const result = await reqPromise(tx.objectStore('sites').getAll());
  await txDone(tx);
  return result;
}
async function dbGetSite(id) {
  const db = await openDatabase();
  const tx = db.transaction('sites', 'readonly');
  const result = await reqPromise(tx.objectStore('sites').get(id));
  await txDone(tx);
  return result;
}
async function dbPutSite(record) {
  const db = await openDatabase();
  const tx = db.transaction('sites', 'readwrite');
  tx.objectStore('sites').put(record);
  await txDone(tx);
}
async function dbDeleteSiteCascade(id) {
  const db = await openDatabase();
  const tx = db.transaction(['sites', 'files'], 'readwrite');
  tx.objectStore('sites').delete(id);
  const idx = tx.objectStore('files').index('bySite');
  await new Promise((resolve, reject) => {
    const cReq = idx.openCursor(IDBKeyRange.only(id));
    cReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); } else resolve();
    };
    cReq.onerror = () => reject(cReq.error);
  });
  await txDone(tx);
}
async function dbGetFilesForSite(siteId) {
  const db = await openDatabase();
  const tx = db.transaction('files', 'readonly');
  const idx = tx.objectStore('files').index('bySite');
  const result = await reqPromise(idx.getAll(IDBKeyRange.only(siteId)));
  await txDone(tx);
  return result;
}
async function dbPutFilesForSite(siteId, filesArr) {
  const db = await openDatabase();
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  for (const f of filesArr) store.put({ siteId, path: f.path, mime: f.mime, blob: f.blob, size: f.size });
  await txDone(tx);
}
async function dbDeleteFilesForSiteOnly(siteId) {
  const db = await openDatabase();
  const tx = db.transaction('files', 'readwrite');
  const idx = tx.objectStore('files').index('bySite');
  await new Promise((resolve, reject) => {
    const cReq = idx.openCursor(IDBKeyRange.only(siteId));
    cReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); } else resolve();
    };
    cReq.onerror = () => reject(cReq.error);
  });
  await txDone(tx);
}
async function dbReplaceFilesForSite(siteId, filesArr) {
  await dbDeleteFilesForSiteOnly(siteId);
  await dbPutFilesForSite(siteId, filesArr);
}
async function dbNextAccession() {
  const db = await openDatabase();
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  const cur = await reqPromise(store.get('nextAccession'));
  const n = (cur && cur.value) ? cur.value : 1;
  store.put({ key: 'nextAccession', value: n + 1 });
  await txDone(tx);
  return n;
}

/* ----------------------------- Utilidades ----------------------------- */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}
function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}
function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: sameYear ? undefined : 'numeric' });
}
function formatDateForFilename(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function normalizeSearch(str) {
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sanitizeFilename(name) {
  return (name || 'site').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80) || 'site';
}
function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}
function resolveRelative(basePath, rel) {
  if (rel == null) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return null; // http:, mailto:, data:, javascript:, ...
  if (rel.startsWith('//')) return null; // protocol-relative
  if (rel.startsWith('#')) return null;
  let clean = rel.split('#')[0].split('?')[0];
  if (clean === '') return null;
  let baseSegs = basePath ? basePath.split('/').filter(Boolean) : [];
  let segs;
  if (clean.startsWith('/')) { segs = []; clean = clean.slice(1); }
  else segs = baseSegs.slice();
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return segs.join('/');
}

const MIME_MAP = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  txt: 'text/plain', xml: 'application/xml', map: 'application/json', pdf: 'application/pdf'
};
function guessMime(path) {
  const ext = path.split('.').pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function base64ToBlob(b64, mime) {
  const res = await fetch(`data:${mime || 'application/octet-stream'};base64,${b64}`);
  return res.blob();
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
async function resizeImageToIconBlob(fileOrBlob, size = 128) {
  try {
    const bitmap = await createImageBitmap(fileOrBlob);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || fileOrBlob), 'image/png', 0.92));
  } catch (e) {
    return fileOrBlob;
  }
}
async function generateInitialsIconBlob(name, size = 128) {
  const words = (name || '?').trim().split(/\s+/).slice(0, 2);
  const initials = words.map((w) => w[0] ? w[0].toUpperCase() : '').join('') || '?';
  const hue = hashHue(name || 'site');
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `hsl(${hue}, 40%, 28%)`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = `hsl(${hue}, 55%, 80%)`;
  ctx.font = `700 ${Math.round(size * 0.4)}px Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials, size / 2, size / 2 + size * 0.04);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/* ----------------------------- ZIP (leitura) -----------------------------
   Lê .zip padrão (criados pelo Windows, macOS, Files do iOS, Android, etc.)
   usando DecompressionStream nativo do navegador — sem nenhuma biblioteca
   externa. Suporta métodos "stored" (0) e "deflate" (8).
   =========================================================================*/

async function inflateRawRawBytes(compData) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compData);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function parseZipArrayBuffer(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const len = buf.length;

  let eocdOffset = -1;
  const scanStart = Math.max(0, len - 65557);
  for (let i = len - 22; i >= scanStart; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('não parece ser um .zip válido');

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  const dec = new TextDecoder('utf-8');

  const rawEntries = [];
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const sig = dv.getUint32(ptr, true);
    if (sig !== 0x02014b50) throw new Error('estrutura de .zip inesperada');
    const compMethod = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = dec.decode(buf.slice(ptr + 46, ptr + 46 + nameLen));
    rawEntries.push({ name, compMethod, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  let usable = rawEntries.filter((e) => {
    if (e.name.endsWith('/')) return false;
    if (e.name.includes('__MACOSX/')) return false;
    const base = e.name.split('/').pop();
    if (base === '.DS_Store' || base.startsWith('._')) return false;
    return true;
  });

  // se todo mundo compartilha a mesma pasta-raiz, removemos esse prefixo
  if (usable.length > 0 && usable.every((e) => e.name.includes('/'))) {
    const firstSeg = usable[0].name.split('/')[0];
    if (usable.every((e) => e.name.split('/')[0] === firstSeg)) {
      usable = usable.map((e) => ({ ...e, name: e.name.slice(firstSeg.length + 1) }));
    }
  }

  const result = new Map();
  for (const entry of usable) {
    const lp = entry.localOffset;
    if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('header local inválido em ' + entry.name);
    const lNameLen = dv.getUint16(lp + 26, true);
    const lExtraLen = dv.getUint16(lp + 28, true);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    const compData = buf.slice(dataStart, dataStart + entry.compSize);
    let bytes;
    if (entry.compMethod === 0) bytes = compData;
    else if (entry.compMethod === 8) bytes = await inflateRawRawBytes(compData);
    else throw new Error('método de compressão não suportado em ' + entry.name);
    result.set(entry.name, bytes);
  }
  return result;
}

/* ----------------------------- Renderizador isolado -----------------------------
   Reconstrói um site guardado dentro de um documento autônomo, trocando toda
   referência relativa (CSS, JS, imagens, url() dentro de CSS, links internos)
   por blob: URLs geradas a partir dos arquivos guardados no IndexedDB. O
   resultado é jogado em um <iframe sandbox="allow-scripts allow-forms
   allow-popups allow-modals"> SEM allow-same-origin — o que dá ao site
   guardado uma origem opaca própria: o CSS/JS dele nunca enxerga nem afeta
   este app ou qualquer outro site do acervo.
   ===================================================================== */

class SiteRenderer {
  constructor(fileMap) {
    this.fileMap = fileMap; // path -> Blob
    this.assetUrls = new Map();
    this.cssUrls = new Map();
    this.textCache = new Map();
  }
  findFile(path) {
    if (path == null) return null;
    if (this.fileMap.has(path)) return path;
    const lower = path.toLowerCase();
    for (const k of this.fileMap.keys()) if (k.toLowerCase() === lower) return k;
    return null;
  }
  getAssetUrl(path) {
    const key = this.findFile(path);
    if (!key) return null;
    if (this.assetUrls.has(key)) return this.assetUrls.get(key);
    const url = URL.createObjectURL(this.fileMap.get(key));
    this.assetUrls.set(key, url);
    return url;
  }
  async getText(path) {
    const key = this.findFile(path);
    if (!key) return null;
    if (this.textCache.has(key)) return this.textCache.get(key);
    const text = await this.fileMap.get(key).text();
    this.textCache.set(key, text);
    return text;
  }
  rewriteCssUrls(cssText, basePath) {
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, raw) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('data:')) return m;
      const resolved = resolveRelative(basePath, raw);
      const url = resolved != null ? this.getAssetUrl(resolved) : null;
      return url ? `url("${url}")` : m;
    });
  }
  async getCssUrl(path) {
    const key = this.findFile(path);
    if (!key) return null;
    if (this.cssUrls.has(key)) return this.cssUrls.get(key);
    const text = await this.getText(key);
    const rewritten = this.rewriteCssUrls(text, dirOf(key));
    const blob = new Blob([rewritten], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    this.cssUrls.set(key, url);
    return url;
  }
  rewriteSrcset(value, basePath) {
    return value.split(',').map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const spaceIdx = trimmed.search(/\s/);
      const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
      if (/^[a-z][a-z0-9+.-]*:/i.test(urlPart) || urlPart.startsWith('//') || urlPart.startsWith('data:')) return trimmed;
      const resolved = resolveRelative(basePath, urlPart);
      const url = resolved != null ? this.getAssetUrl(resolved) : null;
      return (url || urlPart) + rest;
    }).join(', ');
  }
  async renderPage(path) {
    const key = this.findFile(path);
    if (!key) {
      return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;color:#a6432b;background:#f3ecdd;">Arquivo não encontrado neste site: ${escapeHtml(path)}</body></html>`;
    }
    const htmlText = await this.getText(key);
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const baseDir = dirOf(key);

    for (const el of Array.from(doc.querySelectorAll('link[href]'))) {
      const href = el.getAttribute('href');
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, href);
      if (resolved == null) continue;
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      const isCss = rel.includes('stylesheet') || /\.css$/i.test(href);
      const url = isCss ? await this.getCssUrl(resolved) : this.getAssetUrl(resolved);
      if (url) el.setAttribute('href', url);
    }
    for (const el of Array.from(doc.querySelectorAll('script[src]'))) {
      const src = el.getAttribute('src');
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, src);
      const url = resolved != null ? this.getAssetUrl(resolved) : null;
      if (url) el.setAttribute('src', url);
    }
    for (const el of Array.from(doc.querySelectorAll('img[src], source[src], audio[src], video[src], embed[src]'))) {
      const src = el.getAttribute('src');
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, src);
      const url = resolved != null ? this.getAssetUrl(resolved) : null;
      if (url) el.setAttribute('src', url);
    }
    for (const el of Array.from(doc.querySelectorAll('img[srcset], source[srcset]'))) {
      const ss = el.getAttribute('srcset');
      if (ss) el.setAttribute('srcset', this.rewriteSrcset(ss, baseDir));
    }
    for (const el of Array.from(doc.querySelectorAll('style'))) {
      el.textContent = this.rewriteCssUrls(el.textContent || '', baseDir);
    }
    for (const el of Array.from(doc.querySelectorAll('[style]'))) {
      el.setAttribute('style', this.rewriteCssUrls(el.getAttribute('style') || '', baseDir));
    }
    for (const el of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = el.getAttribute('href');
      if (!href) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
        continue;
      }
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      const resolved = resolveRelative(baseDir, href);
      const key2 = resolved != null ? this.findFile(resolved) : null;
      if (key2) {
        el.setAttribute('data-vault-nav', key2);
        el.setAttribute('href', 'javascript:void(0)');
      }
    }
    const bridge = doc.createElement('script');
    bridge.textContent = "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[data-vault-nav]'):null;if(a){e.preventDefault();parent.postMessage({__vaultNav:true,path:a.getAttribute('data-vault-nav')},'*');}},true);";
    (doc.body || doc.documentElement).appendChild(bridge);
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }
  revokeAll() {
    for (const u of this.assetUrls.values()) URL.revokeObjectURL(u);
    for (const u of this.cssUrls.values()) URL.revokeObjectURL(u);
    this.assetUrls.clear(); this.cssUrls.clear(); this.textCache.clear();
  }
}

/* ----------------------------- Estado & elementos ----------------------------- */

const state = {
  index: [],
  filtered: [],
  renderedCount: 0,
  batchSize: 60,
  searchTerm: '',
  sortMode: 'recent',
  pendingFiles: new Map(),
  pendingIcon: null,
  pendingIconIsAuto: true,
  editingSiteId: null,
  openSiteId: null,
  currentRenderer: null,
};

const els = {};
function cacheEls() {
  const ids = [
    'statsLabel', 'searchInput', 'sortSelect', 'exportAllBtn', 'importBtn', 'addBtn',
    'emptyState', 'emptyAddBtn', 'siteGrid', 'sentinel', 'loadMoreHint', 'sheetLayer',
    'editModalBackdrop', 'editModalTitle', 'editModalClose', 'siteNameInput', 'siteDescInput', 'siteTagsInput',
    'iconPreview', 'pickIconBtn', 'autoIconBtn', 'iconFileInput',
    'pickFilesBtn', 'pickFolderBtn', 'pickZipBtn', 'filesInput', 'folderInput', 'zipInput', 'fileListPreview',
    'pickPasteBtn', 'pasteHtmlPanel', 'pasteHtmlFilename', 'pasteHtmlTextarea', 'confirmPasteBtn', 'cancelPasteBtn',
    'entryFileField', 'entryFileSelect', 'editCancelBtn', 'editSaveBtn',
    'importModalBackdrop', 'importModalClose', 'pickImportBtn', 'importFileInput',
    'importProgressWrap', 'importProgressBar', 'importProgressLabel', 'importCloseBtn',
    'confirmModalBackdrop', 'confirmModalTitle', 'confirmModalMessage', 'confirmCancelBtn', 'confirmOkBtn',
    'viewerBackdrop', 'viewerCloseBtn', 'viewerName', 'viewerEditBtn', 'viewerExportBtn', 'viewerExportHtmlBtn', 'viewerLoading', 'viewerIframe',
    'toastStack',
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

const STAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>';

/* ----------------------------- Toasts ----------------------------- */

function showToast(message, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = message;
  els.toastStack.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, isError ? 3800 : 2400);
}

/* ----------------------------- Confirmação ----------------------------- */

function showConfirm(message, okLabel) {
  return new Promise((resolve) => {
    els.confirmModalMessage.textContent = message;
    els.confirmOkBtn.textContent = okLabel || 'Confirmar';
    els.confirmModalBackdrop.classList.remove('hidden');
    const cleanup = (result) => {
      els.confirmModalBackdrop.classList.add('hidden');
      els.confirmOkBtn.removeEventListener('click', onOk);
      els.confirmCancelBtn.removeEventListener('click', onCancel);
      els.confirmModalBackdrop.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === els.confirmModalBackdrop) cleanup(false); };
    els.confirmOkBtn.addEventListener('click', onOk);
    els.confirmCancelBtn.addEventListener('click', onCancel);
    els.confirmModalBackdrop.addEventListener('click', onBackdrop);
  });
}

/* ----------------------------- Índice / grade / busca ----------------------------- */

async function loadIndex() {
  const sites = await dbGetAllSites();
  // libera URLs antigas antes de recriar
  for (const s of state.index) if (s.iconUrl) URL.revokeObjectURL(s.iconUrl);
  state.index = sites.map((s) => ({
    id: s.id, name: s.name, description: s.description || '', tags: s.tags || [],
    createdAt: s.createdAt, updatedAt: s.updatedAt, favorite: !!s.favorite,
    accession: s.accession, entryFile: s.entryFile,
    iconUrl: s.icon ? URL.createObjectURL(s.icon) : null,
    fileCount: s.fileCount || 0, totalSize: s.totalSize || 0,
    searchBlob: normalizeSearch(s.name + ' ' + (s.description || '') + ' ' + (s.tags || []).join(' ')),
  }));
}

function applyFilterAndSort() {
  let arr = state.index;
  if (state.searchTerm) {
    const t = normalizeSearch(state.searchTerm);
    arr = arr.filter((s) => s.searchBlob.includes(t));
  }
  arr = arr.slice();
  if (state.sortMode === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  else if (state.sortMode === 'fav') arr.sort((a, b) => (b.favorite - a.favorite) || (b.updatedAt - a.updatedAt));
  else arr.sort((a, b) => b.updatedAt - a.updatedAt);
  state.filtered = arr;
  state.renderedCount = 0;
  els.siteGrid.innerHTML = '';
  els.emptyState.classList.toggle('hidden', state.index.length > 0);
  renderNextBatch();
}

function renderNextBatch() {
  const start = state.renderedCount;
  const end = Math.min(start + state.batchSize, state.filtered.length);
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) frag.appendChild(renderCard(state.filtered[i]));
  els.siteGrid.appendChild(frag);
  state.renderedCount = end;

  if (state.filtered.length === 0 && state.searchTerm) {
    els.loadMoreHint.classList.remove('hidden');
    els.loadMoreHint.textContent = `Nenhum site encontrado para "${state.searchTerm}"`;
  } else {
    els.loadMoreHint.classList.add('hidden');
  }
}

function renderCard(site) {
  const card = document.createElement('div');
  card.className = 'site-card';
  card.setAttribute('role', 'listitem');
  card.tabIndex = 0;
  card.dataset.id = site.id;
  card.innerHTML = `
    <span class="site-tab">Nº ${String(site.accession || 0).padStart(4, '0')}</span>
    <button class="site-fav" data-active="${site.favorite}" aria-label="Favoritar" title="Favoritar">${STAR_SVG}</button>
    <div class="site-icon">${site.iconUrl ? `<img src="${site.iconUrl}" alt="" loading="lazy">` : ''}</div>
    <div class="site-name">${escapeHtml(site.name)}</div>
    <div class="site-meta">
      ${site.tags.slice(0, 3).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      <span>${formatDate(site.updatedAt)}</span>
    </div>
    <button class="site-kebab" aria-label="Mais opções" title="Mais opções">⋮</button>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.site-fav') || e.target.closest('.site-kebab')) return;
    openViewer(site.id);
  });
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openViewer(site.id); });
  card.querySelector('.site-fav').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(site.id); });
  card.querySelector('.site-kebab').addEventListener('click', (e) => { e.stopPropagation(); openActionSheet(site.id); });
  return card;
}

function setupInfiniteScroll() {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.renderedCount < state.filtered.length) renderNextBatch();
  }, { rootMargin: '500px' });
  io.observe(els.sentinel);
}

async function updateStatsFooter() {
  const count = state.index.length;
  let usageStr = '';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageStr = ' · ' + formatBytes(est.usage || 0) + ' usados';
    } catch (e) { /* estimate indisponível, ignora */ }
  }
  els.statsLabel.textContent = `${count} site${count === 1 ? '' : 's'}${usageStr}`;
}

async function toggleFavorite(id) {
  const site = await dbGetSite(id);
  if (!site) return;
  site.favorite = !site.favorite;
  await dbPutSite(site);
  const idxItem = state.index.find((s) => s.id === id);
  if (idxItem) idxItem.favorite = site.favorite;
  if (state.sortMode === 'fav') {
    applyFilterAndSort();
  } else {
    const btn = els.siteGrid.querySelector(`.site-card[data-id="${id}"] .site-fav`);
    if (btn) btn.setAttribute('data-active', String(site.favorite));
  }
}

/* ----------------------------- Menu de ações (kebab) ----------------------------- */

function openActionSheet(siteId) {
  const site = state.index.find((s) => s.id === siteId);
  if (!site) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${escapeHtml(site.name)}</div>
      <button class="sheet-item" data-action="open">Abrir</button>
      <button class="sheet-item" data-action="edit">Editar</button>
      <button class="sheet-item" data-action="export">Exportar este site (.json)</button>
      <button class="sheet-item" data-action="export-html">Baixar como HTML (.html)</button>
      <button class="sheet-item" data-action="fav">${site.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</button>
      <button class="sheet-item danger" data-action="delete">Excluir</button>
      <button class="sheet-cancel" data-action="cancel">Cancelar</button>
    </div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) { backdrop.remove(); return; }
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    backdrop.remove();
    if (action === 'open') openViewer(siteId);
    else if (action === 'edit') openEditModal(siteId);
    else if (action === 'export') exportSite(siteId);
    else if (action === 'export-html') exportSiteAsHtml(siteId);
    else if (action === 'fav') toggleFavorite(siteId);
    else if (action === 'delete') confirmDeleteSite(siteId);
  });
  els.sheetLayer.appendChild(backdrop);
}

async function confirmDeleteSite(id) {
  const site = state.index.find((s) => s.id === id);
  if (!site) return;
  const ok = await showConfirm(`Excluir "${site.name}"? Essa ação não pode ser desfeita — exporte antes se quiser guardar uma cópia.`, 'Excluir');
  if (!ok) return;
  await dbDeleteSiteCascade(id);
  if (site.iconUrl) URL.revokeObjectURL(site.iconUrl);
  state.index = state.index.filter((s) => s.id !== id);
  applyFilterAndSort();
  updateStatsFooter();
  showToast('Site excluído.');
}

/* ----------------------------- Visualizador (sandbox) ----------------------------- */

async function openViewer(id) {
  const site = await dbGetSite(id);
  if (!site) { showToast('Site não encontrado.', true); return; }
  state.openSiteId = id;
  els.viewerName.textContent = site.name;
  els.viewerBackdrop.classList.remove('hidden');
  els.viewerLoading.classList.remove('hidden');
  try {
    const filesArr = await dbGetFilesForSite(id);
    const fileMap = new Map(filesArr.map((f) => [f.path, f.blob]));
    if (state.currentRenderer) state.currentRenderer.revokeAll();
    state.currentRenderer = new SiteRenderer(fileMap);
    await showPage(site.entryFile);
  } catch (err) {
    showToast('Não consegui abrir esse site: ' + err.message, true);
  }
  els.viewerLoading.classList.add('hidden');
}
async function showPage(path) {
  if (!state.currentRenderer) return;
  const html = await state.currentRenderer.renderPage(path);
  els.viewerIframe.srcdoc = html;
}
function closeViewer() {
  els.viewerBackdrop.classList.add('hidden');
  els.viewerIframe.removeAttribute('srcdoc');
  if (state.currentRenderer) { state.currentRenderer.revokeAll(); state.currentRenderer = null; }
  state.openSiteId = null;
}
window.addEventListener('message', (e) => {
  if (e.data && e.data.__vaultNav && typeof e.data.path === 'string') showPage(e.data.path);
});

/* ----------------------------- Modal Adicionar / Editar ----------------------------- */

function resetEditModalState() {
  state.pendingFiles = new Map();
  state.pendingIcon = null;
  state.pendingIconIsAuto = true;
  els.siteNameInput.value = '';
  els.siteDescInput.value = '';
  els.siteTagsInput.value = '';
  els.iconPreview.innerHTML = '';
  els.autoIconBtn.classList.add('hidden');
  els.fileListPreview.innerHTML = '';
  els.fileListPreview.classList.add('hidden');
  els.entryFileField.classList.add('hidden');
  els.entryFileSelect.innerHTML = '';
  
  // NOVO: Limpa e esconde o campo de colar HTML
  if(els.pasteHtmlContainer) els.pasteHtmlContainer.classList.add('hidden');
  if(els.pasteHtmlTextarea) els.pasteHtmlTextarea.value = '';
}
// NOVA FUNÇÃO: Transforma o texto colado em um arquivo de fato (index.html)
function addPastedHtml() {
  const htmlContent = els.pasteHtmlTextarea.value.trim();
  if (!htmlContent) {
    showToast('O campo de HTML está vazio.', true);
    return;
  }
  
  // Cria um arquivo virtual a partir do texto
  const blob = new Blob([htmlContent], { type: 'text/html' });
  
  // Garante que o nome não vai sobrescrever outro arquivo colado anteriormente se existir
  let filename = 'index.html';
  let counter = 1;
  while (state.pendingFiles.has(filename)) {
    filename = `index_${counter}.html`;
    counter++;
  }
  
  state.pendingFiles.set(filename, { blob, size: blob.size, mime: 'text/html' });
  refreshFileListPreview();
  autoDetectEntryAndIcon();
  
  // Limpa o textarea e oculta o container
  els.pasteHtmlTextarea.value = '';
  els.pasteHtmlContainer.classList.add('hidden');
  showToast(`Arquivo ${filename} adicionado com sucesso.`);
}
function openAddModal() {
  resetEditModalState();
  state.editingSiteId = null;
  els.editModalTitle.textContent = 'Novo site';
  els.editModalBackdrop.classList.remove('hidden');
  els.siteNameInput.focus();
}

async function openEditModal(id) {
  resetEditModalState();
  const site = await dbGetSite(id);
  if (!site) { showToast('Site não encontrado.', true); return; }
  const filesArr = await dbGetFilesForSite(id);
  state.editingSiteId = id;
  els.editModalTitle.textContent = 'Editar site';
  els.siteNameInput.value = site.name;
  els.siteDescInput.value = site.description || '';
  els.siteTagsInput.value = (site.tags || []).join(', ');
  for (const f of filesArr) state.pendingFiles.set(f.path, { blob: f.blob, size: f.size, mime: f.mime });
  if (site.icon) {
    state.pendingIcon = site.icon;
    state.pendingIconIsAuto = site.iconIsAuto !== false;
    renderIconPreview(site.icon);
    if (!state.pendingIconIsAuto) els.autoIconBtn.classList.remove('hidden');
  }
  refreshFileListPreview();
  refreshEntryFileOptions(site.entryFile);
  els.editModalBackdrop.classList.remove('hidden');
}

function closeEditModal() { els.editModalBackdrop.classList.add('hidden'); }

function findPendingFile(path) {
  if (state.pendingFiles.has(path)) return path;
  const lower = path.toLowerCase();
  for (const k of state.pendingFiles.keys()) if (k.toLowerCase() === lower) return k;
  return null;
}

function detectEntryFile(htmlFiles) {
  const exact = htmlFiles.find((p) => /(^|\/)index\.html?$/i.test(p));
  return exact || htmlFiles.slice().sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

function refreshEntryFileOptions(preferredPath) {
  const htmlFiles = Array.from(state.pendingFiles.keys()).filter((p) => /\.html?$/i.test(p));
  if (htmlFiles.length === 0) { els.entryFileField.classList.add('hidden'); return; }
  els.entryFileField.classList.remove('hidden');
  htmlFiles.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  els.entryFileSelect.innerHTML = htmlFiles.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  const detected = preferredPath && htmlFiles.includes(preferredPath) ? preferredPath : detectEntryFile(htmlFiles);
  els.entryFileSelect.value = detected;
}

function refreshFileListPreview() {
  const entries = Array.from(state.pendingFiles.entries());
  if (entries.length === 0) { els.fileListPreview.classList.add('hidden'); els.fileListPreview.innerHTML = ''; return; }
  els.fileListPreview.classList.remove('hidden');
  els.fileListPreview.innerHTML = entries.map(([path, info]) => `
    <div class="file-list-row" data-path="${escapeHtml(path)}">
      <span class="fname">${escapeHtml(path)}</span>
      <span class="fsize">${formatBytes(info.size)}</span>
      <button type="button" aria-label="Remover ${escapeHtml(path)}">✕</button>
    </div>`).join('');
  els.fileListPreview.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.closest('.file-list-row').dataset.path;
      state.pendingFiles.delete(path);
      refreshFileListPreview();
      refreshEntryFileOptions();
    });
  });
}

async function autoDetectEntryAndIcon() {
  refreshEntryFileOptions();
  if (state.pendingIcon && state.pendingIconIsAuto === false) return; // usuário já escolheu um ícone próprio
  const entryPath = els.entryFileSelect.value;
  if (!entryPath) return;
  const entryInfo = state.pendingFiles.get(entryPath);
  if (!entryInfo) return;
  try {
    const text = await entryInfo.blob.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const linkEl = doc.querySelector('link[rel~="icon" i], link[rel~="apple-touch-icon" i]');
    if (linkEl) {
      const href = linkEl.getAttribute('href');
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('data:')) {
        const resolved = resolveRelative(dirOf(entryPath), href);
        const match = resolved != null ? findPendingFile(resolved) : null;
        if (match) {
          const resized = await resizeImageToIconBlob(state.pendingFiles.get(match).blob);
          state.pendingIcon = resized;
          state.pendingIconIsAuto = true;
          renderIconPreview(resized);
        }
      }
    }
  } catch (e) { /* html malformado ou não parseável — ignora, fica sem ícone auto */ }
}

function renderIconPreview(blob) {
  const url = URL.createObjectURL(blob);
  els.iconPreview.innerHTML = `<img src="${url}" alt="">`;
}

function addFilesFromFileList(fileList, fromFolder) {
  const arr = Array.from(fileList);
  for (const file of arr) {
    let path = fromFolder && file.webkitRelativePath ? file.webkitRelativePath : file.name;
    if (fromFolder) {
      const segs = path.split('/');
      if (segs.length > 1) path = segs.slice(1).join('/');
    }
    state.pendingFiles.set(path, { blob: file, size: file.size, mime: file.type || guessMime(path) });
  }
  refreshFileListPreview();
  autoDetectEntryAndIcon();
}

async function saveSite() {
  const name = els.siteNameInput.value.trim();
  if (!name) { showToast('Dá um nome pro site antes de salvar.', true); els.siteNameInput.focus(); return; }
  if (state.pendingFiles.size === 0) { showToast('Adicione ao menos um arquivo.', true); return; }
  const htmlFiles = Array.from(state.pendingFiles.keys()).filter((p) => /\.html?$/i.test(p));
  if (htmlFiles.length === 0) { showToast('Nenhum arquivo .html entre os arquivos selecionados.', true); return; }
  const entryFile = els.entryFileSelect.value || detectEntryFile(htmlFiles);
  const tags = els.siteTagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
  const description = els.siteDescInput.value.trim();

  els.editSaveBtn.disabled = true;
  try {
    let iconBlob = state.pendingIcon;
    if (!iconBlob) iconBlob = await generateInitialsIconBlob(name);

    const filesArr = Array.from(state.pendingFiles.entries()).map(([path, info]) => ({
      path, mime: info.mime || guessMime(path), blob: info.blob, size: info.size,
    }));
    const totalSize = filesArr.reduce((a, f) => a + f.size, 0);
    const now = Date.now();

    let siteId = state.editingSiteId;
    let accession, favorite, createdAt;
    if (siteId) {
      const existing = await dbGetSite(siteId);
      accession = existing.accession;
      favorite = existing.favorite;
      createdAt = existing.createdAt;
    } else {
      siteId = uid();
      accession = await dbNextAccession();
      favorite = false;
      createdAt = now;
    }

    const record = {
      id: siteId, name, description, tags, entryFile,
      icon: iconBlob, iconIsAuto: state.pendingIconIsAuto,
      fileCount: filesArr.length, totalSize,
      favorite, accession, createdAt, updatedAt: now,
    };
    await dbPutSite(record);
    await dbReplaceFilesForSite(siteId, filesArr);

    closeEditModal();
    await loadIndex();
    applyFilterAndSort();
    updateStatsFooter();
    showToast(state.editingSiteId ? 'Site atualizado.' : 'Site adicionado ao acervo.');
  } catch (err) {
    showToast('Não consegui salvar: ' + err.message, true);
  } finally {
    els.editSaveBtn.disabled = false;
  }
}

/* ----------------------------- Exportar como .html autônomo -----------------------------
   Diferente do SiteRenderer (que usa blob: URLs, válidas só durante a sessão
   dentro deste app), aqui tudo vira data: URI ou é embutido diretamente no
   HTML — o arquivo resultante funciona sozinho, fora do app, pra sempre.
   Só a página de entrada é exportada (sites com várias páginas HTML mantêm
   as demais fora deste arquivo único; use o backup .json pra levar tudo).
   ===================================================================== */

class StandaloneHtmlBuilder {
  constructor(fileMap) {
    this.fileMap = fileMap;
    this.dataUriCache = new Map();
  }
  findFile(path) {
    if (path == null) return null;
    if (this.fileMap.has(path)) return path;
    const lower = path.toLowerCase();
    for (const k of this.fileMap.keys()) if (k.toLowerCase() === lower) return k;
    return null;
  }
  async getDataUri(path) {
    const key = this.findFile(path);
    if (!key) return null;
    if (this.dataUriCache.has(key)) return this.dataUriCache.get(key);
    const blob = this.fileMap.get(key);
    const b64 = await blobToBase64(blob);
    const uri = `data:${blob.type || guessMime(key)};base64,${b64}`;
    this.dataUriCache.set(key, uri);
    return uri;
  }
  async getText(path) {
    const key = this.findFile(path);
    if (!key) return null;
    return this.fileMap.get(key).text();
  }
  async rewriteCssUrlsToData(cssText, basePath) {
    const matches = [...cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
    let out = '';
    let lastIndex = 0;
    for (const m of matches) {
      const raw = m[2];
      let replacement = m[0];
      if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('data:') && !raw.startsWith('//')) {
        const resolved = resolveRelative(basePath, raw);
        const uri = resolved != null ? await this.getDataUri(resolved) : null;
        if (uri) replacement = `url("${uri}")`;
      }
      out += cssText.slice(lastIndex, m.index) + replacement;
      lastIndex = m.index + m[0].length;
    }
    out += cssText.slice(lastIndex);
    return out;
  }
  async build(entryPath) {
    const key = this.findFile(entryPath);
    if (!key) throw new Error('arquivo principal não encontrado');
    const htmlText = await this.getText(key);
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const baseDir = dirOf(key);

    for (const el of Array.from(doc.querySelectorAll('link[href]'))) {
      const href = el.getAttribute('href');
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, href);
      if (resolved == null) continue;
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      const isCss = rel.includes('stylesheet') || /\.css$/i.test(href);
      if (isCss) {
        const text = await this.getText(resolved);
        if (text != null) {
          const styleEl = doc.createElement('style');
          styleEl.textContent = await this.rewriteCssUrlsToData(text, dirOf(resolved));
          el.replaceWith(styleEl);
        }
      } else {
        const uri = await this.getDataUri(resolved);
        if (uri) el.setAttribute('href', uri);
      }
    }
    for (const el of Array.from(doc.querySelectorAll('script[src]'))) {
      const src = el.getAttribute('src');
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, src);
      const text = resolved != null ? await this.getText(resolved) : null;
      if (text != null) { el.removeAttribute('src'); el.textContent = text; }
    }
    for (const el of Array.from(doc.querySelectorAll('img[src], source[src], audio[src], video[src], embed[src]'))) {
      const src = el.getAttribute('src');
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('data:')) continue;
      const resolved = resolveRelative(baseDir, src);
      const uri = resolved != null ? await this.getDataUri(resolved) : null;
      if (uri) el.setAttribute('src', uri);
    }
    for (const el of Array.from(doc.querySelectorAll('img[srcset], source[srcset]'))) {
      const ss = el.getAttribute('srcset');
      if (!ss) continue;
      const newParts = [];
      for (const part of ss.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const spaceIdx = trimmed.search(/\s/);
        const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
        if (/^[a-z][a-z0-9+.-]*:/i.test(urlPart) || urlPart.startsWith('//') || urlPart.startsWith('data:')) { newParts.push(trimmed); continue; }
        const resolved = resolveRelative(baseDir, urlPart);
        const uri = resolved != null ? await this.getDataUri(resolved) : null;
        newParts.push((uri || urlPart) + rest);
      }
      el.setAttribute('srcset', newParts.join(', '));
    }
    for (const el of Array.from(doc.querySelectorAll('style'))) {
      el.textContent = await this.rewriteCssUrlsToData(el.textContent || '', baseDir);
    }
    for (const el of Array.from(doc.querySelectorAll('[style]'))) {
      el.setAttribute('style', await this.rewriteCssUrlsToData(el.getAttribute('style') || '', baseDir));
    }
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }
}

async function exportSiteAsHtml(id) {
  showToast('Preparando HTML…');
  try {
    const site = await dbGetSite(id);
    const filesArr = await dbGetFilesForSite(id);
    if (filesArr.length === 1 && /\.html?$/i.test(filesArr[0].path)) {
      downloadBlob(filesArr[0].blob, sanitizeFilename(site.name) + '.html');
      showToast('HTML exportado.');
      return;
    }
    const fileMap = new Map(filesArr.map((f) => [f.path, f.blob]));
    const builder = new StandaloneHtmlBuilder(fileMap);
    const html = await builder.build(site.entryFile);
    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob(blob, sanitizeFilename(site.name) + '.html');
    const htmlPagesCount = filesArr.filter((f) => /\.html?$/i.test(f.path)).length;
    showToast(htmlPagesCount > 1
      ? 'HTML exportado — só a página principal (esse site tem mais páginas; use o backup .json pra levar tudo).'
      : 'HTML exportado — um arquivo só, com tudo embutido.');
  } catch (err) {
    showToast('Erro ao exportar HTML: ' + err.message, true);
  }
}

/* ----------------------------- Exportar (.json) ----------------------------- */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function buildSiteExportObject(id) {
  const site = await dbGetSite(id);
  const filesArr = await dbGetFilesForSite(id);
  const files = {};
  for (const f of filesArr) files[f.path] = { mime: f.mime, data: await blobToBase64(f.blob) };
  return {
    id: site.id, name: site.name, description: site.description, tags: site.tags,
    entryFile: site.entryFile, iconIsAuto: site.iconIsAuto,
    iconData: site.icon ? await blobToBase64(site.icon) : null,
    iconMime: site.icon ? (site.icon.type || 'image/png') : null,
    favorite: site.favorite, accession: site.accession,
    createdAt: site.createdAt, updatedAt: site.updatedAt,
    files,
  };
}

async function exportSite(id) {
  showToast('Preparando exportação…');
  try {
    const obj = await buildSiteExportObject(id);
    const payload = { app: 'meus-sites-vault', version: 1, exportedAt: Date.now(), sites: [obj] };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    downloadBlob(blob, sanitizeFilename(obj.name) + '.json');
    showToast('Site exportado.');
  } catch (err) {
    showToast('Erro ao exportar: ' + err.message, true);
  }
}

async function exportAll() {
  if (state.index.length === 0) { showToast('Não há sites para exportar ainda.', true); return; }
  showToast(`Exportando ${state.index.length} site(s)… pode levar um tempinho.`);
  try {
    const sites = [];
    for (const s of state.index) sites.push(await buildSiteExportObject(s.id));
    const payload = { app: 'meus-sites-vault', version: 1, exportedAt: Date.now(), sites };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    downloadBlob(blob, 'meus-sites-backup-' + formatDateForFilename(new Date()) + '.json');
    showToast('Backup completo exportado.');
  } catch (err) {
    showToast('Erro ao exportar tudo: ' + err.message, true);
  }
}
/* ----------------------------- Exportar ----------------------------- */
// exportar html
// NOVA FUNÇÃO: Exporta um site individualmente apenas como arquivo .html
async function exportSiteAsHtml(id) {
  showToast('Preparando exportação em HTML…');
  try {
    const site = await dbGetSite(id);
    const filesArr = await dbGetFilesForSite(id);
    
    // Busca o arquivo principal do site (entryFile)
    let entryPath = site.entryFile;
    let entryFileObj = filesArr.find(f => f.path === entryPath);
    
    // Fallback de segurança: caso não encontre pelo nome exato, pega o primeiro .html
    if (!entryFileObj) {
        const htmlFiles = filesArr.filter(f => /\.html?$/i.test(f.path));
        if (htmlFiles.length > 0) {
            entryFileObj = htmlFiles[0];
        } else if (filesArr.length > 0) {
            entryFileObj = filesArr[0]; 
        } else {
            throw new Error('Nenhum arquivo encontrado no site para exportar.');
        }
    }
    
    // Efetua o download do Blob como arquivo HTML original
    const safeFilename = site.name ? site.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'site';
    downloadBlob(entryFileObj.blob, safeFilename + '.html');
    
    showToast('Site exportado como HTML.');
  } catch (err) {
    showToast('Erro ao exportar como HTML: ' + err.message, true);
  }
}
/* ----------------------------- Importar ----------------------------- */

function updateImportProgress(done, total, label) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  els.importProgressBar.style.width = pct + '%';
  els.importProgressLabel.textContent = label;
}

async function importSiteObject(obj) {
  const newId = uid();
  const filesArr = [];
  for (const [path, finfo] of Object.entries(obj.files || {})) {
    const blob = await base64ToBlob(finfo.data, finfo.mime);
    filesArr.push({ path, mime: finfo.mime || guessMime(path), blob, size: blob.size });
  }
  const iconBlob = obj.iconData ? await base64ToBlob(obj.iconData, obj.iconMime || 'image/png') : await generateInitialsIconBlob(obj.name || 'Site');
  const accession = await dbNextAccession();
  const now = Date.now();
  const record = {
    id: newId, name: obj.name || 'Site importado', description: obj.description || '', tags: obj.tags || [],
    entryFile: obj.entryFile, icon: iconBlob, iconIsAuto: obj.iconIsAuto !== false,
    fileCount: filesArr.length, totalSize: filesArr.reduce((a, f) => a + f.size, 0),
    favorite: false, accession, createdAt: obj.createdAt || now, updatedAt: now,
  };
  await dbPutSite(record);
  await dbPutFilesForSite(newId, filesArr);
}

async function importZipAsSite(defaultName, entriesMap) {
  const filesArr = [];
  for (const [path, bytes] of entriesMap) {
    const mime = guessMime(path);
    const blob = new Blob([bytes], { type: mime });
    filesArr.push({ path, mime, blob, size: blob.size });
  }
  const htmlFiles = filesArr.map((f) => f.path).filter((p) => /\.html?$/i.test(p));
  if (htmlFiles.length === 0) throw new Error('nenhum arquivo .html encontrado no .zip');
  const entryFile = detectEntryFile(htmlFiles);

  let iconBlob = null;
  try {
    const entryFileObj = filesArr.find((f) => f.path === entryFile);
    const text = await entryFileObj.blob.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const linkEl = doc.querySelector('link[rel~="icon" i], link[rel~="apple-touch-icon" i]');
    if (linkEl) {
      const href = linkEl.getAttribute('href');
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        const resolved = resolveRelative(dirOf(entryFile), href);
        const match = resolved != null ? filesArr.find((f) => f.path.toLowerCase() === resolved.toLowerCase()) : null;
        if (match) iconBlob = await resizeImageToIconBlob(match.blob);
      }
    }
  } catch (e) { /* sem favicon detectável, tudo bem */ }
  if (!iconBlob) iconBlob = await generateInitialsIconBlob(defaultName);

  const newId = uid();
  const accession = await dbNextAccession();
  const now = Date.now();
  const record = {
    id: newId, name: defaultName, description: '', tags: [],
    entryFile, icon: iconBlob, iconIsAuto: true,
    fileCount: filesArr.length, totalSize: filesArr.reduce((a, f) => a + f.size, 0),
    favorite: false, accession, createdAt: now, updatedAt: now,
  };
  await dbPutSite(record);
  await dbPutFilesForSite(newId, filesArr);
}

async function handleImportFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;
  els.importProgressWrap.classList.remove('hidden');
  let importedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    updateImportProgress(i, files.length, `Lendo ${file.name}…`);
    try {
      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const payload = JSON.parse(text);
        const sitesArr = Array.isArray(payload.sites) ? payload.sites : (payload.files ? [payload] : []);
        for (let j = 0; j < sitesArr.length; j++) {
          updateImportProgress(i + j / Math.max(sitesArr.length, 1), files.length, `Importando "${sitesArr[j].name || 'site'}"…`);
          await importSiteObject(sitesArr[j]);
          importedCount++;
        }
      } else if (/\.zip$/i.test(file.name)) {
        if (typeof DecompressionStream === 'undefined') throw new Error('seu navegador não suporta leitura de .zip');
        const buf = await file.arrayBuffer();
        const entries = await parseZipArrayBuffer(buf);
        await importZipAsSite(file.name.replace(/\.zip$/i, ''), entries);
        importedCount++;
      } else {
        showToast('Formato não reconhecido: ' + file.name, true);
      }
    } catch (err) {
      showToast('Erro ao importar ' + file.name + ': ' + err.message, true);
    }
  }
  updateImportProgress(files.length, files.length, `Concluído: ${importedCount} site(s) importado(s).`);
  await loadIndex();
  applyFilterAndSort();
  updateStatsFooter();
}

/* ----------------------------- Registro do Service Worker (opcional) ----------------------------- */

function isHostedContext() {
  // manifest e service worker só fazem sentido (e só funcionam sem erro de
  // CORS) quando o app está servido por http(s) ou localhost — em file://
  // o navegador bloqueia a busca do manifest, então nem tentamos.
  return location.protocol === 'https:' || location.protocol === 'http:' || location.hostname === 'localhost';
}
function injectManifestLinkIfPossible() {
  if (!isHostedContext()) return;
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
}
function registerServiceWorkerIfPossible() {
  if (!isHostedContext()) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* funciona sem SW também */ });
  }
}

/* ----------------------------- Wiring ----------------------------- */

function wireEvents() {
  els.searchInput.addEventListener('input', debounce(() => {
    state.searchTerm = els.searchInput.value.trim();
    applyFilterAndSort();
  }, 150));
  els.sortSelect.addEventListener('change', () => {
    state.sortMode = els.sortSelect.value;
    applyFilterAndSort();
  });

  els.addBtn.addEventListener('click', openAddModal);
  els.emptyAddBtn.addEventListener('click', openAddModal);
  els.editModalClose.addEventListener('click', closeEditModal);
  els.editCancelBtn.addEventListener('click', closeEditModal);
  els.editModalBackdrop.addEventListener('click', (e) => { if (e.target === els.editModalBackdrop) closeEditModal(); });
  els.editSaveBtn.addEventListener('click', saveSite);

  els.pickFilesBtn.addEventListener('click', () => els.filesInput.click());
  els.filesInput.addEventListener('change', () => { addFilesFromFileList(els.filesInput.files, false); els.filesInput.value = ''; });

  if ('webkitdirectory' in document.createElement('input')) els.pickFolderBtn.classList.remove('hidden');
  els.pickFolderBtn.addEventListener('click', () => els.folderInput.click());
  els.folderInput.addEventListener('change', () => { addFilesFromFileList(els.folderInput.files, true); els.folderInput.value = ''; });

  if (typeof DecompressionStream === 'undefined') {
    els.pickZipBtn.disabled = true;
    els.pickZipBtn.title = 'Seu navegador não suporta importar .zip — use "Selecionar arquivo(s)".';
  }
  els.pickZipBtn.addEventListener('click', () => els.zipInput.click());
  els.zipInput.addEventListener('change', async () => {
    const file = els.zipInput.files[0];
    els.zipInput.value = '';
    if (!file) return;
    try {
      showToast('Lendo .zip…');
      const buf = await file.arrayBuffer();
      const entries = await parseZipArrayBuffer(buf);
      for (const [path, bytes] of entries) {
        const mime = guessMime(path);
        const blob = new Blob([bytes], { type: mime });
        state.pendingFiles.set(path, { blob, size: blob.size, mime });
      }
      refreshFileListPreview();
      await autoDetectEntryAndIcon();
      showToast(`${entries.size} arquivo(s) adicionados do .zip.`);
    } catch (err) {
      showToast('Não consegui ler esse .zip: ' + err.message, true);
    }
  });

  els.pickPasteBtn.addEventListener('click', () => {
    els.pasteHtmlPanel.classList.toggle('hidden');
    if (!els.pasteHtmlPanel.classList.contains('hidden')) els.pasteHtmlTextarea.focus();
  });
  els.cancelPasteBtn.addEventListener('click', () => {
    els.pasteHtmlPanel.classList.add('hidden');
    els.pasteHtmlTextarea.value = '';
  });
  els.confirmPasteBtn.addEventListener('click', () => {
    const code = els.pasteHtmlTextarea.value;
    if (!code.trim()) { showToast('Cole algum código HTML antes.', true); return; }
    let filename = els.pasteHtmlFilename.value.trim() || 'index.html';
    if (!/\.html?$/i.test(filename)) filename += '.html';
    const blob = new Blob([code], { type: 'text/html' });
    state.pendingFiles.set(filename, { blob, size: blob.size, mime: 'text/html' });
    refreshFileListPreview();
    autoDetectEntryAndIcon();
    els.pasteHtmlPanel.classList.add('hidden');
    els.pasteHtmlTextarea.value = '';
    els.pasteHtmlFilename.value = 'index.html';
    showToast(`"${filename}" adicionado.`);
  });

  els.pickIconBtn.addEventListener('click', () => els.iconFileInput.click());
  els.iconFileInput.addEventListener('change', async () => {
    const file = els.iconFileInput.files[0];
    els.iconFileInput.value = '';
    if (!file) return;
    const resized = await resizeImageToIconBlob(file);
    state.pendingIcon = resized; state.pendingIconIsAuto = false;
    renderIconPreview(resized);
    els.autoIconBtn.classList.remove('hidden');
  });
  els.autoIconBtn.addEventListener('click', async () => {
    state.pendingIcon = null; state.pendingIconIsAuto = true;
    els.iconPreview.innerHTML = '';
    els.autoIconBtn.classList.add('hidden');
    await autoDetectEntryAndIcon();
  });

  els.entryFileSelect.addEventListener('change', () => { autoDetectEntryAndIcon(); });

  els.exportAllBtn.addEventListener('click', exportAll);

  els.importBtn.addEventListener('click', () => {
    els.importProgressWrap.classList.add('hidden');
    els.importProgressBar.style.width = '0%';
    els.importModalBackdrop.classList.remove('hidden');
  });
  els.importModalClose.addEventListener('click', () => els.importModalBackdrop.classList.add('hidden'));
  els.importCloseBtn.addEventListener('click', () => els.importModalBackdrop.classList.add('hidden'));
  els.importModalBackdrop.addEventListener('click', (e) => { if (e.target === els.importModalBackdrop) els.importModalBackdrop.classList.add('hidden'); });
  els.pickImportBtn.addEventListener('click', () => els.importFileInput.click());
  els.importFileInput.addEventListener('change', async () => {
    const files = els.importFileInput.files;
    els.importFileInput.value = '';
    await handleImportFiles(files);
  });

  els.viewerCloseBtn.addEventListener('click', closeViewer);
  els.viewerEditBtn.addEventListener('click', () => {
    const id = state.openSiteId;
    closeViewer();
    if (id) openEditModal(id);
  });
  els.viewerExportBtn.addEventListener('click', () => {
    if (state.openSiteId) exportSite(state.openSiteId);
  });

  // NOVO: Ação do botão de exportar apenas HTML
  els.viewerExportHtmlBtn.addEventListener('click', () => {
    if (state.openSiteId) exportSiteAsHtml(state.openSiteId);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.sheetLayer.firstChild) { els.sheetLayer.innerHTML = ''; return; }
    if (!els.confirmModalBackdrop.classList.contains('hidden')) { els.confirmCancelBtn.click(); return; }
    if (!els.importModalBackdrop.classList.contains('hidden')) { els.importModalBackdrop.classList.add('hidden'); return; }
    if (!els.editModalBackdrop.classList.contains('hidden')) { closeEditModal(); return; }
    if (!els.viewerBackdrop.classList.contains('hidden')) { closeViewer(); return; }
  });
}

/* ----------------------------- Início ----------------------------- */

async function init() {
  cacheEls();
  wireEvents();
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ok */ }
  await loadIndex();
  applyFilterAndSort();
  updateStatsFooter();
  setupInfiniteScroll();
  injectManifestLinkIfPossible();
  registerServiceWorkerIfPossible();
}

document.addEventListener('DOMContentLoaded', init);