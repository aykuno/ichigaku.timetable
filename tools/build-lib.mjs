import { webcrypto, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { decryptHtml } from './crypto.mjs';
export const activityBridge = "\n;(() => {\n  let lastSent = 0;\n  for (const eventName of ['pointerdown','keydown','touchstart','wheel']) {\n    window.addEventListener(eventName, () => {\n      const now = Date.now();\n      if (now - lastSent >= 5000) {\n        lastSent = now;\n        parent.postMessage({type:'timetable-activity'}, '*');\n      }\n    }, {passive:true});\n  }\n})();\n";
const features = readFileSync(new URL('./features.js',import.meta.url),'utf8');
const featureStyles = readFileSync(new URL('./features.css',import.meta.url),'utf8');
export function prepareContent(source) {
  if (!/<!doctype html>/i.test(source) || !/<script>[\s\S]*<\/script>/.test(source)) throw new Error('Expected the complete self-contained timetable HTML.');
  if (/<(?:script|iframe)\b[^>]*\bsrc\s*=|<link\b/i.test(source)) throw new Error('External resources must be removed before protecting this document.');
  const enhanced = /const DATA\s*=/.test(source) && !source.includes('timetable-enhancements-v1');
  if (enhanced) source = source.replace('</style>', featureStyles + '</style>').replace('</script>', '\n' + features + '</script>');
  return source.replace('</script>', activityBridge + '</script>').replace(
    '<meta charset="utf-8">',
    '<meta charset="utf-8">\n<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">\n<meta name="referrer" content="no-referrer">');
}
export async function encryptHtml(html, password) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    {name:'PBKDF2', hash:'SHA-256', salt, iterations:600000},
    material, {name:'AES-GCM', length:256}, false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128}, key, new TextEncoder().encode(html));
  return {version:1, algorithm:'AES-256-GCM', kdf:'PBKDF2-SHA-256', iterations:600000,
    salt:salt.toString('base64'), iv:iv.toString('base64'), ciphertext:Buffer.from(encrypted).toString('base64')};
}
export async function renderPage(plaintext, payload) {
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
  const gate = await readFile(new URL('./gate.js', import.meta.url), 'utf8');
  const preferences = await readFile(new URL('./preferences.js',import.meta.url),'utf8');
  const pdf = await readFile(new URL('./pdf.js',import.meta.url),'utf8');
  const script = '\n' + decryptHtml.toString() + '\n\n' + preferences + '\n' + pdf + '\n' + gate;
  const digest = value => createHash('sha256').update(value, 'utf8').digest('base64');
  const contentHashes = [...plaintext.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => "'sha256-" + digest(match[1]) + "'").join(' ');
  return template.replace('@@GATE_HASH@@', digest(script)).replace('@@CONTENT_HASHES@@', contentHashes)
    .replace('@@PAYLOAD@@', JSON.stringify(payload)).replace('@@GATE_SCRIPT@@', script);
}
