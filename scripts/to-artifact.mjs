// Turns dist/index.html (a full standalone document, playable offline from disk) into
// dist/artifact.html: the same page without the document skeleton, which the artifact host adds.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const src = readFileSync('dist/index.html', 'utf8');
const title = src.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Lights Out</title>';
let body = src
  .replace(/<!doctype html>/i, '')
  .replace(/<html[^>]*>|<\/html>/gi, '')
  .replace(/<head>|<\/head>/gi, '')
  .replace(/<body[^>]*>|<\/body>/gi, '')
  .replace(/<title>[\s\S]*?<\/title>/, '')
  .replace(/<meta charset="[^"]*">/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
body = body.replace(/<meta name="claude:viewport-fit-sides"[^>]*>/i, '');
const out = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${body.trim()}\n`;
writeFileSync('dist/artifact.html', out);
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
console.log(`dist/artifact.html ${kb(statSync('dist/artifact.html').size)} (gzip ${kb(gzipSync(out).length)}); standalone dist/index.html ${kb(statSync('dist/index.html').size)}`);
