// Test helpers: real PDFs generated with pdfkit (Latin text), and a tiny PNG.
const PDFDocument = require('pdfkit');

function makePdf(lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ compress: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    for (const l of lines) doc.text(l);
    doc.end();
  });
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

module.exports = { makePdf, PNG };
