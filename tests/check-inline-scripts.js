// Syntax-check every inline <script> block in index.html with Node's parser.
// (CI previously checked only the small external .js files.)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, n = 0, failed = false;
while ((m = re.exec(html))) {
  n++;
  const tmp = path.join(os.tmpdir(), `inline-script-${n}.js`);
  fs.writeFileSync(tmp, m[1]);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`Syntax OK: inline script #${n}`);
  } catch (e) {
    failed = true;
    console.error(`Syntax error in inline script #${n}:\n${e.stderr.toString()}`);
  }
}
if (n === 0) { console.error('No inline scripts found'); process.exit(1); }
process.exit(failed ? 1 : 0);
