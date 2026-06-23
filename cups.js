const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execFileAsync = promisify(execFile);

const CUPS_HOST = process.env.CUPS_HOST || '100.71.170.2';
const CUPS_PORT = process.env.CUPS_PORT || '631';
const cupsAddr = `${CUPS_HOST}:${CUPS_PORT}`;

const WHITELIST_FILE = process.env.PRINTER_WHITELIST_FILE || path.join(__dirname, 'printer-whitelist.txt');

function loadWhitelistPatterns() {
  try {
    return fs.readFileSync(WHITELIST_FILE, 'utf8').split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch (err) {
    return [];
  }
}

function isWhitelisted(printer) {
  const patterns = loadWhitelistPatterns();
  if (patterns.length === 0) return true;
  const escapeRe = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return patterns.some(p => new RegExp(`^${p.split('*').map(escapeRe).join('.*')}$`, 'i').test(printer));
}

async function listPrinters() {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-a', '-h', cupsAddr], { timeout: 5000 });
    const printers = stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => line.split(/\s+/)[0]);
    return { ok: true, printers };
  } catch (err) {
    return { ok: false, printers: [], error: 'CUPS-Server nicht erreichbar' };
  }
}

const PT_TO_MM = 25.4 / 72;

async function getPrinterMedia(printer) {
  try {
    const { stdout } = await execFileAsync('lpoptions', ['-p', printer, '-l'], { timeout: 5000 });
    const line = stdout.split('\n').find(l => l.startsWith('PageSize'));
    if (!line) return { ok: false };

    const match = line.match(/\*(\S+)/);
    if (!match) return { ok: false };
    const value = match[1];

    const custom = value.match(/^w([\d.]+)h([\d.]+)$/i);
    if (custom) {
      const widthMm = parseFloat(custom[1]) * PT_TO_MM;
      const heightMm = parseFloat(custom[2]) * PT_TO_MM;
      return {
        ok: true,
        name: value,
        widthMm,
        heightMm,
        orientation: widthMm > heightMm ? 'landscape' : 'portrait'
      };
    }

    return { ok: true, name: value, widthMm: null, heightMm: null, orientation: null };
  } catch (err) {
    return { ok: false };
  }
}

async function submitPrint({ filePath, stdinData, printer, copies, pages, orientation, scale }) {
  const args = ['-d', printer, '-h', cupsAddr, '-n', String(copies)];
  if (pages) args.push('-P', pages);
  args.push('-o', `orientation-requested=${orientation === 'landscape' ? '4' : '3'}`);
  args.push('-o', `print-scaling=${scale === 'fit' ? 'fit' : 'none'}`);
  if (filePath) args.push(filePath);

  try {
    const job = execFileAsync('lp', args, { timeout: 30000 });
    if (stdinData != null) {
      job.child.stdin.end(stdinData);
    }
    const { stdout } = await job;
    const match = stdout.match(/request id is (\S+)/);
    return { ok: true, jobId: match ? match[1] : 'submitted' };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

module.exports = { listPrinters, submitPrint, getPrinterMedia, isWhitelisted };
