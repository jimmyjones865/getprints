const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { listPrinters, submitPrint } = require('./cups');
const { detectOrientation } = require('./analyze');

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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/printers', async (req, res) => {
  res.json(await listPrinters());
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
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const { printer, copies = '1', pages = '', orientation = 'portrait', scale = 'none' } = req.body;
  if (!printer) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'printer required' });
  }
  try {
    res.json(await submitPrint({
      filePath: req.file.path,
      printer,
      copies: Math.max(1, parseInt(copies) || 1),
      pages: pages.trim(),
      orientation,
      scale
    }));
  } finally {
    cleanup(req.file.path);
  }
});

app.use((err, req, res, next) => {
  if (req.file) cleanup(req.file.path);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 100MB)' });
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`getprints on :${PORT}`));
