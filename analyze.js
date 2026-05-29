const fs = require('fs');
const sizeOf = require('image-size');

function detectOrientation(file) {
  if (file.mimetype === 'application/pdf') return detectPdf(file.path);
  if (file.mimetype.startsWith('image/')) return detectImage(file.path);
  return 'portrait';
}

function detectPdf(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    // MediaBox: [llx lly urx ury] — urx is page width, ury is page height
    const match = buf.slice(0, bytesRead).toString('latin1')
      .match(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/);
    if (match) return parseFloat(match[1]) > parseFloat(match[2]) ? 'landscape' : 'portrait';
  } catch (e) { /* fall through */ }
  return 'portrait';
}

function detectImage(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    const dims = sizeOf(buf.slice(0, bytesRead));
    return dims.width > dims.height ? 'landscape' : 'portrait';
  } catch (e) {
    return 'portrait';
  }
}

module.exports = { detectOrientation };
