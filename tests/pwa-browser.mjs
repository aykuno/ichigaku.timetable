import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';
import {prepareContent,encryptHtml,renderPage} from '../tools/build-lib.mjs';
const password='public-offline-test-password',prefix='/ichigaku.timetable/';
const source=await readFile(new URL('./fixtures/timetable.html',import.meta.url),'utf8');
const content=prepareContent(source),html=await renderPage(content,await encryptHtml(content,password));
const assets=new Map();
for(const [path,type] of [['sw.js','text/javascript'],['manifest.webmanifest','application/manifest+json'],['icons/icon-192.png','image/png'],['icons/icon-512.png','image/png'],['icons/apple-touch-icon.png','image/png']]){
  assets.set(prefix+path,{type,bytes:await readFile(new URL('../'+path,import.meta.url))});
}
const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const asset=assets.get(pathname);
  if(asset){res.writeHead(200,{'Content-Type':asset.type});res.end(asset.bytes);return;}
  if(pathname===prefix||pathname===prefix+'index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  res.writeHead(404);res.end('Not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,url='http://127.0.0.1:'+port+prefix;
try{
  for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await engine.launch();
    try{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
      await page.goto(url+'?v=online');
      assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'),'./manifest.webmanifest');
      const manifest=await page.evaluate(async()=>await(await fetch('./manifest.webmanifest')).json());
      assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
      for(const icon of manifest.icons){
        const dimensions=await page.evaluate(async path=>{
          const image=new Image();image.src=path;await image.decode();return [image.naturalWidth,image.naturalHeight];
        },icon.src);
        assert.deepEqual(dimensions,icon.sizes.split('x').map(Number));
      }
      await page.evaluate(async()=>{await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker did not become ready')),12000))]);});
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const cached=await page.evaluate(async()=>{
        const name=(await caches.keys()).find(x=>x.startsWith('ichigaku-timetable-'));
        const cache=await caches.open(name),keys=await cache.keys();
        return {paths:keys.map(x=>new URL(x.url).pathname),html:await(await cache.match(new URL('./',location.href))).text()};
      });
      assert.deepEqual(cached.paths.sort(),[prefix,prefix+'manifest.webmanifest',prefix+'icons/icon-192.png',prefix+'icons/icon-512.png',prefix+'icons/apple-touch-icon.png'].sort());
      assert.ok(cached.html.includes('encrypted-payload'));assert.ok(!cached.html.includes('const DATA ='));
      // Install guidance works even without the Chromium-only native prompt.
      await page.locator('#install-login').click();
      await page.locator('#install-dialog').waitFor();await page.locator('#install-dialog button').click();
      if(name==='Chromium'){
        await page.evaluate(()=>{
          const event=new Event('beforeinstallprompt',{cancelable:true});
          event.prompt=async()=>{window.installRequested=true;};
          event.userChoice=Promise.resolve({outcome:'accepted'});
          dispatchEvent(event);
        });
        await page.locator('#install-login').click();
        assert.equal(await page.evaluate(()=>window.installRequested),true);
      }
      await page.locator('#password').fill(password);await page.locator('#unlock').click();
      const app=page.frameLocator('#screen-1 iframe');
      await app.locator('#q').fill('6-2');await app.locator('#results .result').first().click();
      await app.locator('#viewer .title').filter({hasText:'6-2'}).waitFor();
      await app.locator('#favorite-toggle').click();
      await page.waitForFunction(()=>!!localStorage.getItem('ichigaku.timetable.preferences.v1'));
      // Playwright WebKit offline emulation rejects worker-served navigation
      // (microsoft/playwright#42775). Stop the origin to test actual failed requests.
      if(name==='Chromium')await context.setOffline(true);
      else await new Promise(resolve=>server.close(resolve));
      const offlineResponse=await page.goto(url+'?v=offline');
      assert.equal(offlineResponse.status(),200);
      assert.equal(offlineResponse.fromServiceWorker(),true);
      assert.equal(await page.locator('iframe').count(),0,'offline reload still requires a password');
      await page.locator('#password').fill(password);await page.locator('#unlock').click();
      await app.locator('#q').fill('6-2');await app.locator('#results .result').first().click();
      await app.locator('#viewer .title').filter({hasText:'6-2'}).waitFor();
      assert.equal(await app.locator('.table td').count(),42);
      await app.locator('#favorites-list button').filter({hasText:'6-2'}).waitFor();
      if(name==='Chromium')assert.equal(await page.locator('#offline-status').isVisible(),true);
      await page.locator('#home').click();await app.locator('#viewer .title').filter({hasText:'時間割を選択してください'}).waitFor();
      await app.locator('#favorites-list button').filter({hasText:'6-2'}).waitFor();
      await page.locator('#logout').click();assert.equal(await page.locator('iframe').count(),0);
      const offlineCached=await page.evaluate(async()=>{
        const name=(await caches.keys()).find(x=>x.startsWith('ichigaku-timetable-'));
        return await(await(await caches.open(name)).match(new URL('./',location.href))).text();
      });
      assert.ok(!offlineCached.includes('const DATA ='),'only encrypted public HTML is cached');
      if(name==='Chromium')await context.setOffline(false);
      else await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
      await page.reload();
      assert.equal(await page.locator('#offline-status').isVisible(),false);
      assert.deepEqual(errors,[]);
      await context.close();
      console.log(name+': GitHub subpath manifest/icons, install guidance, encrypted offline cache, password gate, favorites and home reset passed');
    }finally{await browser.close();}
  }
}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
