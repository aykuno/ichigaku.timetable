import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decryptHtml } from '../tools/crypto.mjs';
import { encryptHtml, renderPage, prepareContent } from '../tools/build-lib.mjs';
const fixture = JSON.parse(await readFile(new URL('./crypto-fixture.json', import.meta.url), 'utf8'));
test('decrypts an independent AES-256-GCM / PBKDF2 fixture including Japanese text', async () => {
  assert.equal(await decryptHtml(fixture.payload, fixture.password), fixture.plaintext);
});
test('rejects an incorrect password', async () => {
  await assert.rejects(decryptHtml(fixture.payload, 'incorrect-password'));
});
test('rejects modified ciphertext, salt and IV', async () => {
  for (const field of ['ciphertext','salt','iv']) {
    const bytes = Buffer.from(fixture.payload[field], 'base64'); bytes[0] ^= 1;
    await assert.rejects(decryptHtml({...fixture.payload, [field]:bytes.toString('base64')}, fixture.password));
  }
});
test('rejects downgraded algorithms and invalid envelopes', async () => {
  for (const change of [{iterations:1},{algorithm:'AES-CBC'},{version:2},{salt:'AA=='},{iv:'!not-base64!'}])
    await assert.rejects(decryptHtml({...fixture.payload,...change},fixture.password));
});
test('encryption preserves exact Japanese HTML with fresh salts and nonces', async () => {
  const secret = 'a-public-test-password-that-is-long';
  const one = await encryptHtml(fixture.plaintext, secret), two = await encryptHtml(fixture.plaintext, secret);
  assert.notEqual(one.salt,two.salt); assert.notEqual(one.iv,two.iv);
  assert.equal(await decryptHtml(one,secret),fixture.plaintext);
});
test('committed timetable has encrypted content, correct CSP hashes and no plaintext application', async () => {
  const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(page,await readFile(new URL('../index.txt',import.meta.url),'utf8'));
  assert.ok(!page.includes('const DATA =')); assert.ok(!page.includes(fixture.password));
  assert.ok(!page.includes('sessionStorage'));
  assert.ok(page.includes('localStorage.setItem(SAVED_KEY,JSON.stringify(sealed))'));
  assert.match(page,/content="noindex,nofollow,noarchive,nosnippet"/); assert.match(page,/connect-src 'none'/);
  const envelope = JSON.parse(page.match(/id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(envelope.version,1);
  assert.equal(envelope.algorithm,'AES-256-GCM');
  assert.equal(envelope.iterations,600000);
  assert.equal(Buffer.from(envelope.salt,'base64').length,16);
  assert.equal(Buffer.from(envelope.iv,'base64').length,12);
  assert.ok(Buffer.from(envelope.ciphertext,'base64').length>100000);
  assert.ok(page.includes('現在準備中です。'));
  const executable = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(executable).digest('base64');
  assert.ok(page.includes("'sha256-"+hash+"'")); assert.ok(executable.includes(decryptHtml.toString()));
  new Function(executable);
});
test('builder outputs a standalone protected page and rejects external content', async () => {
  const source = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>document.title="fixture";</script></body></html>';
  const content = prepareContent(source), payload = await encryptHtml(content,fixture.password);
  const page = await renderPage(content,payload);
  assert.ok(!page.includes('@@')); assert.ok(!page.includes('document.title="fixture"'));
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(page.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
  assert.throws(() => prepareContent(source.replace('<script>','<script src="https://example.com/x.js">')));
});

test('404 and the build template both tell Google not to index them', async () => {
  for (const path of ['../404.html','../tools/template.html']) {
    const text = await readFile(new URL(path,import.meta.url),'utf8');
    assert.match(text,/<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/);
    assert.match(text,/<meta name="googlebot" content="noindex,nofollow,nosnippet">/);
  }
});

test('saved preferences use a separate authenticated encryption key and nonce', async () => {
  const {webcrypto}=await import('node:crypto');
  const source=await readFile(new URL('../tools/preferences.js',import.meta.url),'utf8');
  const api=new Function('crypto',source+'\nreturn preferenceCrypto;')(webcrypto);
  const password='public-preference-fixture-password';
  const session=await api.open(password,null);
  const preferences={favorites:['teacher:架空教員'],recent:['class:6-2'],bells:{}};
  const one=await api.seal(session,preferences),two=await api.seal(session,preferences);
  assert.notEqual(one.iv,two.iv);
  assert.ok(!JSON.stringify(one).includes('架空教員'));
  assert.deepEqual((await api.open(password,one)).preferences,preferences);
  await assert.rejects(api.open('wrong-password',one));
  const tampered=Buffer.from(one.ciphertext,'base64');tampered[0]^=1;
  await assert.rejects(api.open(password,{...one,ciphertext:tampered.toString('base64')}));
  const changed=api.update(preferences,{type:'favorite',key:'class:6-3',enabled:true});
  assert.deepEqual(changed.favorites,['teacher:架空教員','class:6-3']);
  const invalid=api.update(changed,{type:'bells',mode:'high',value:[['09:20','08:30'],null,null,null,null,null,null]});
  assert.deepEqual(invalid,changed);
});
