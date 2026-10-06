/* GitHub Pages only. Public assets contain encrypted timetable data. */
const VERSION='2026-10-06-grade3-12';
const CACHE='ichigaku-timetable-'+VERSION;
const ROOT=new URL('./',self.location.href);
const ASSETS=['./','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'].map(path=>new URL(path,ROOT).href);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith('ichigaku-timetable-')&&key!==CACHE)await caches.delete(key);
    await self.clients.claim();
  })());
});

// PDFs remain only in worker memory. They are never added to offline caches.
const heldPdfs=new Map();
function cleanupPdfs(){
  const now=Date.now();
  for(const [url,entry] of heldPdfs)if(entry.expires<now)heldPdfs.delete(url);
}
self.addEventListener('message',event=>{
  const client=event.source,data=event.data;
  if(!client?.url||!data)return;
  const owner=new URL(client.url);
  if(owner.origin!==ROOT.origin||!(owner.pathname===ROOT.pathname||owner.pathname===ROOT.pathname+'index.html'))return;
  cleanupPdfs();
  if(data.type==='timetable-release-pdf'){
    const entry=heldPdfs.get(data.url);
    if(entry?.owner===client.id)heldPdfs.delete(data.url);
  }
  if(data.type==='timetable-hold-pdf'){
    const bytes=data.bytes;
    if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<100||bytes.byteLength>15000000||!String.fromCharCode(...new Uint8Array(bytes,0,5)).startsWith('%PDF-'))return;
    const filename=String(data.filename||'2026時間割.pdf').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,180);
    const token=crypto.randomUUID(),url=new URL('__pdf/'+token+'/'+encodeURIComponent(filename),ROOT).href;
    for(const [oldUrl,entry] of heldPdfs)if(entry.owner===client.id)heldPdfs.delete(oldUrl);
    heldPdfs.set(url,{bytes,filename,owner:client.id,expires:Date.now()+30*60*1000});
    event.ports[0]?.postMessage({url});
  }
});

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==ROOT.origin)return;
  if(url.pathname.startsWith(ROOT.pathname+'__pdf/')){
    cleanupPdfs();
    const key=new URL(url);key.search='';key.hash='';
    const entry=heldPdfs.get(key.href);
    const headers={'Content-Type':'application/pdf','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if(!entry){event.respondWith(new Response('PDFの保存画面から、もう一度開いてください。',{status:410,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}}));return;}
    const encoded=encodeURIComponent(entry.filename).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
    headers['Content-Disposition']=(url.searchParams.has('download')?'attachment':'inline')+"; filename=\"timetable.pdf\"; filename*=UTF-8''"+encoded;
    event.respondWith(new Response(entry.bytes.slice(0),{headers}));return;
  }
  const documentRequest=request.mode==='navigate'&&(url.pathname===ROOT.pathname||url.pathname===ROOT.pathname+'index.html');
  const asset=ASSETS.find(value=>new URL(value).pathname===url.pathname);
  if(!documentRequest&&!asset)return;
  const key=documentRequest?ROOT.href:asset;
  const cachePromise=caches.open(CACHE);
  const network=(async()=>{
    const response=await fetch(new Request(request,{cache:'no-cache'}));
    if(!response.ok||response.type==='opaque'||new URL(response.url).origin!==ROOT.origin)throw new Error('Unavailable');
    if(documentRequest&&!response.headers.get('content-type')?.includes('text/html'))throw new Error('Invalid page');
    const cache=await cachePromise;
    try{await cache.put(key,response.clone());}catch{}
    return response;
  })();
  // Register background work while the fetch event is still being dispatched.
  event.waitUntil(network.then(()=>{},()=>{}));
  event.respondWith((async()=>{
    const cache=await cachePromise;
    const cached=await cache.match(key);
    if(!documentRequest){try{return await network;}catch{return cached||Response.error();}}
    if(!cached)return network;
    const fallback=new Promise(resolve=>setTimeout(()=>resolve(cached),3500));
    return Promise.race([network.catch(()=>cached),fallback]);
  })());
});
