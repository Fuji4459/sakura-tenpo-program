const CACHE="sakura-store-denpyo-v3";
const SHELL=["./","./index.html","./manifest.json","./icon-192.png","./icon-512.png","./apple-touch-icon.png","./sw.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method==="GET")e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});
