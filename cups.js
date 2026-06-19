const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const CUPS_HOST = process.env.CUPS_HOST || '100.71.170.2';
const CUPS_PORT = process.env.CUPS_PORT || '631';
const cupsAddr = `${CUPS_HOST}:${CUPS_PORT}`;

async function listPrinters() {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-a', '-h', cupsAddr], { timeout: 5000 });
    const printers = stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => line.split(/\s+/)[0]);
    return { ok: true, printers };
  } catch (err) {
    return { ok: false, printers: [], error: 'CUPS server unreachable' };
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

module.exports = { listPrinters, submitPrint };
