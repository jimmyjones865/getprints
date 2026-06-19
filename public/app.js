'use strict';

const $ = id => document.getElementById(id);

let currentFile = null;
let currentBlobUrl = null;
let serverOk = false;

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'
];

document.addEventListener('DOMContentLoaded', () => {
  setupDropZone();
  $('refreshBtn').addEventListener('click', loadPrinters);
  $('printBtn').addEventListener('click', handlePrint);
  $('clearFile').addEventListener('click', clearFile);
  $('cancelBtn').addEventListener('click', clearFile);
  $('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  $('printerSelect').addEventListener('change', () => {
    updatePrintButton();
    loadPrinterMedia();
  });
  $('textInput').addEventListener('input', () => {
    if ($('textInput').value.trim() && currentFile) clearFile({ keepText: true });
    updatePrintButton();
  });
  loadPrinters();
});

// ── Drop zone ──────────────────────────────────────────────

function setupDropZone() {
  const zone = $('dropZone');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  zone.addEventListener('click', e => {
    if (!currentFile || e.target === zone || e.target.id === 'dropHint' || e.target.closest('#dropHint')) {
      $('fileInput').click();
    }
  });
}

// ── File handling ──────────────────────────────────────────

async function handleFile(file) {
  if (!ALLOWED_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
    showStatus('Nur PDF- und Bilddateien werden unterstützt', 'error');
    return;
  }

  clearFile();
  $('textInput').value = '';
  currentFile = file;
  currentBlobUrl = URL.createObjectURL(file);

  if (file.type === 'application/pdf') {
    $('pdfPreview').src = currentBlobUrl;
    $('pdfPreview').classList.remove('hidden');
  } else {
    $('imgPreview').src = currentBlobUrl;
    $('imgPreview').classList.remove('hidden');
  }

  $('dropHint').classList.add('hidden');
  $('fileName').textContent = file.name;
  $('fileBar').classList.remove('hidden');
  updatePrintButton();

  // Auto-detect orientation (non-blocking, best-effort)
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/analyze', { method: 'POST', body: fd });
    if (res.ok) {
      const { orientation } = await res.json();
      const radio = document.querySelector(`input[name="orientation"][value="${orientation}"]`);
      if (radio) radio.checked = true;
    }
  } catch (e) { /* non-fatal */ }
}

function clearFile({ keepText = false } = {}) {
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  currentFile = null;

  $('pdfPreview').src = '';
  $('pdfPreview').classList.add('hidden');
  $('imgPreview').src = '';
  $('imgPreview').classList.add('hidden');
  $('dropHint').classList.remove('hidden');
  $('fileBar').classList.add('hidden');
  $('fileInput').value = '';
  if (!keepText) $('textInput').value = '';
  hideStatus();
  updatePrintButton();
}

// ── Printers ───────────────────────────────────────────────

async function loadPrinters() {
  setServerStatus('checking');
  try {
    const res = await fetch('/api/printers');
    const data = await res.json();
    const select = $('printerSelect');
    const prev = select.value;

    if (data.ok) {
      serverOk = true;
      setServerStatus('ok');
      if (data.printers.length === 0) {
        select.innerHTML = '<option value="">Keine Drucker gefunden</option>';
      } else {
        select.innerHTML = '<option value="">— Drucker wählen —</option>';
        data.printers.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p.replace(/_/g, ' ');
          select.appendChild(opt);
        });
        if (prev && data.printers.includes(prev)) select.value = prev;
      }
    } else {
      serverOk = false;
      setServerStatus('error');
      select.innerHTML = '<option value="">— nicht verfügbar —</option>';
    }
  } catch (e) {
    serverOk = false;
    setServerStatus('error');
    $('printerSelect').innerHTML = '<option value="">— nicht verfügbar —</option>';
  }
  updatePrintButton();
  loadPrinterMedia();
}

async function loadPrinterMedia() {
  const printer = $('printerSelect').value;
  const el = $('printerMedia');
  if (!printer) { el.textContent = ''; return; }

  try {
    const res = await fetch(`/api/printer-media?printer=${encodeURIComponent(printer)}`);
    const data = await res.json();
    if (!data.ok) { el.textContent = ''; return; }

    el.textContent = data.widthMm
      ? `${data.widthMm.toFixed(1)} × ${data.heightMm.toFixed(1)}mm`
      : data.name;

    if (data.orientation) {
      const radio = document.querySelector(`input[name="orientation"][value="${data.orientation}"]`);
      if (radio) radio.checked = true;
    }
  } catch (e) {
    el.textContent = '';
  }
}

function setServerStatus(state) {
  $('statusDot').className = 'status-dot ' + state;
  $('statusText').textContent = {
    ok: 'Mit Druckserver verbunden',
    error: 'Nicht mit Druckserver verbunden',
    checking: 'Wird geprüft…'
  }[state];
}

// ── Print ──────────────────────────────────────────────────

async function handlePrint() {
  const text = $('textInput').value.trim();
  if (!(currentFile || text) || !$('printerSelect').value) return;

  const btn = $('printBtn');
  btn.disabled = true;
  btn.textContent = 'Wird gesendet…';
  hideStatus();

  const fd = new FormData();
  if (currentFile) {
    fd.append('file', currentFile);
  } else {
    fd.append('text', text);
    const codeType = document.querySelector('input[name="textMode"]:checked').value;
    if (codeType !== 'plain') fd.append('codeType', codeType);
  }
  fd.append('printer', $('printerSelect').value);
  fd.append('copies', $('copies').value);
  fd.append('pages', $('pages').value.trim());
  fd.append('orientation', document.querySelector('input[name="orientation"]:checked').value);
  fd.append('scale', document.querySelector('input[name="scale"]:checked').value);

  try {
    const res = await fetch('/api/print', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) {
      const jobId = data.jobId;
      clearFile();
      showStatus(`Gesendet — Auftrag ${jobId}`, 'success');
    } else {
      showStatus(data.error || 'Drucken fehlgeschlagen', 'error');
    }
  } catch (e) {
    showStatus('Netzwerkfehler', 'error');
  } finally {
    btn.textContent = 'Drucken';
    updatePrintButton();
  }
}

// ── Helpers ────────────────────────────────────────────────

function hasContent() {
  return Boolean(currentFile || $('textInput').value.trim());
}

function updatePrintButton() {
  $('printBtn').disabled = !(hasContent() && $('printerSelect').value && serverOk);
  $('cancelBtn').disabled = !hasContent();
}

function showStatus(msg, type) {
  const el = $('printStatus');
  el.textContent = msg;
  el.className = 'print-status ' + type;
  el.classList.remove('hidden');
}

function hideStatus() {
  $('printStatus').classList.add('hidden');
}
