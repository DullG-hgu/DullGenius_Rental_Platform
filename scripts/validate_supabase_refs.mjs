import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Include untracked source files and local environment backups, never Git history
// or dependency/build output. Report paths only; matched values stay private.
const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
}).split('\0').filter(Boolean));
for (const name of fs.readdirSync('.')) {
  if (/^\.env(?:\..*)?$/.test(name)) files.add(name);
}

const obsoleteName = /\b(?:VITE_|REACT_APP_)?SUPABASE_(?:ANON|SERVICE)?_?KEY\b/;
const embeddedJwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
let failures = 0;
for (const file of files) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('\0')) continue;
  if (obsoleteName.test(source) || embeddedJwt.test(source)) {
    console.error(`Supabase key contract violation: ${file}`);
    failures++;
  }
}
if (failures) process.exit(1);
console.log('Supabase reference contract valid: no obsolete key names or embedded JWTs.');
