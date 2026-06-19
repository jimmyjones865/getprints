const bwipjs = require('bwip-js');
const PDFDocument = require('pdfkit');

const MM = 72 / 25.4; // points per mm
const MARGIN = 2 * MM;

const TRANSLITERATE = {
  'ß': 'ss', 'ä': 'ae', 'ö': 'oe', 'ü': 'ue',
  'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE'
};

function transliterate(text) {
  return text.replace(/[ßäöüÄÖÜ]/g, c => TRANSLITERATE[c] || c);
}

function fitFontSize(doc, text, maxWidth, maxHeight, startSize = 10, minSize = 5) {
  let size = startSize;
  doc.font('Helvetica');
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.heightOfString(text, { width: maxWidth }) <= maxHeight) break;
    size -= 0.5;
  }
  return size;
}

async function generateLabelPdf(text, symbology, widthMm = 55, heightMm = 30) {
  const pageW = widthMm * MM;
  const pageH = heightMm * MM;
  const codeH = pageH * 0.6 - MARGIN;
  const textH = pageH * 0.4 - MARGIN;

  const codeText = symbology === 'code128' ? transliterate(text) : text;

  const png = await bwipjs.toBuffer({
    bcid: symbology === 'qrcode' ? 'qrcode' : 'code128',
    text: codeText,
    scale: 4,
    eclevel: symbology === 'qrcode' ? 'M' : undefined,
    includetext: false
  });

  const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.image(png, MARGIN, MARGIN, {
    fit: [pageW - 2 * MARGIN, codeH],
    align: 'center',
    valign: 'center'
  });

  const textBoxW = pageW - 2 * MARGIN;
  const textY = MARGIN + codeH + 2;
  const fontSize = fitFontSize(doc, text, textBoxW, textH);
  doc.fontSize(fontSize).text(text, MARGIN, textY, { width: textBoxW, align: 'center' });

  doc.end();
  return done;
}

module.exports = { generateLabelPdf };
