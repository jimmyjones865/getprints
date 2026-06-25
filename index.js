const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { listPrinters, submitPrint, getPrinterMedia, isWhitelisted } = require('./cups');
const { detectOrientation } = require('./analyze');
const { generateLabelPdf } = require('./labels');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: '/tmp',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `getprints-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

function cleanup(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

function sweepOrphans() {
  fs.readdir('/tmp', (err, files) => {
    if (err) return;
    const cutoff = Date.now() - 60 * 60 * 1000;
    files.filter(f => f.startsWith('getprints-')).forEach(f => {
      const p = path.join('/tmp', f);
      fs.stat(p, (err, stat) => {
        if (!err && stat.mtimeMs < cutoff) fs.unlink(p, () => {});
      });
    });
  });
}
setInterval(sweepOrphans, 60 * 60 * 1000);
sweepOrphans();

const TEXT_MAX_CHARS = 4000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/printers', async (req, res) => {
  const { ok, printers, error } = await listPrinters();
  res.json({ ok, error, printers: printers.map(name => ({ name, allowed: isWhitelisted(name) })) });
});

app.get('/api/printer-media', async (req, res) => {
  if (!req.query.printer) return res.status(400).json({ ok: false });
  res.json(await getPrinterMedia(req.query.printer));
});

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    res.json({ orientation: detectOrientation(req.file) });
  } finally {
    cleanup(req.file.path);
  }
});

app.post('/api/print', upload.single('file'), async (req, res) => {
  const { printer, copies = '1', pages = '', orientation = 'portrait', scale = 'none', text, codeType } = req.body;

  const filePath = req.file && req.file.path;
  if (!filePath && !(text && text.trim())) return res.status(400).json({ error: 'Keine Datei oder Text' });

  if (text && text.length > TEXT_MAX_CHARS) {
    cleanup(filePath);
    return res.status(400).json({ error: `Text zu lang (max. ${TEXT_MAX_CHARS} Zeichen)` });
  }

  if (!printer) {
    cleanup(filePath);
    return res.status(400).json({ error: 'Drucker erforderlich' });
  }
  const { printers: knownPrinters } = await listPrinters();
  if (!knownPrinters.includes(printer)) {
    cleanup(filePath);
    return res.status(400).json({ error: 'Ungültiger Drucker' });
  }
  if (!isWhitelisted(printer)) {
    cleanup(filePath);
    return res.status(400).json({ error: 'Drucker nicht erlaubt' });
  }
  try {
    let stdinData, printOrientation = orientation, printScale = scale;
    if (!filePath && codeType) {
      const media = await getPrinterMedia(printer);
      const widthMm = media.widthMm || 55;
      const heightMm = media.heightMm || 30;
      const rotate = (widthMm > heightMm) !== (orientation === 'landscape');
      stdinData = await generateLabelPdf(text.trim(), codeType, widthMm, heightMm, rotate);
      printOrientation = 'portrait';
      printScale = 'none';
    } else if (!filePath) {
      stdinData = text;
    }

    res.json(await submitPrint({
      filePath,
      stdinData,
      printer,
      copies: Math.max(1, parseInt(copies) || 1),
      pages: pages.trim(),
      orientation: printOrientation,
      scale: printScale
    }));
  } finally {
    cleanup(filePath);
  }
});

app.use((err, req, res, next) => {
  if (req.file) cleanup(req.file.path);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Datei zu groß (max. 100 MB)' });
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`getprints on :${PORT}`));
