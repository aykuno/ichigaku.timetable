/* GitHub Pages only. Public assets contain encrypted timetable data. */
const VERSION='2026-10-06-ui7';
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
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==ROOT.origin)return;
  const documentRequest=request.mode==='navigate'&&(url.pathname===ROOT.pathname||url.pathname===ROOT.pathname+'index.html');
  const asset=ASSETS.find(value=>new URL(value).pathname===url.pathname);
  if(!documentRequest&&!asset)return;
  const key=documentRequest?ROOT.href:asset;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Navigation gets a fresh page, but slow or failed connections use the cached page.
    const network=fetch(new Request(request,{cache:'no-cache'})).then(async response=>{
      if(!response.ok||response.type==='opaque')throw new Error('Unavailable');
      if(documentRequest&&!response.headers.get('content-type')?.includes('text/html'))throw new Error('Invalid page');
      await cache.put(key,response.clone());return response;
    });
    if(!documentRequest){try{return await network;}catch{return (await cache.match(key))||Response.error();}}
    const cached=await cache.match(key);
    if(!cached)return network;
    const fallback=new Promise(resolve=>setTimeout(()=>resolve(cached),3500));
    // Keep the cache update alive even when the cached response wins the race.
    event.waitUntil(network.then(()=>{},()=>{}));
    return Promise.race([network.catch(()=>cached),fallback]);
  })());
});
