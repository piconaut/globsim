// Writes dist/index.html: index.html without its document wrapper, for hosts
// that supply their own <html>/<head>/<body> skeleton. Scripts stay as files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', `${head.trim()}\n${body.trim()}\n`);
console.log('wrote dist/index.html');
