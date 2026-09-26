/*
 * 「QuitWriteRead」的离线外壳。
 *
 * 只有两条策略，但每条都是必须的：
 *
 * ① 导航请求（也就是「打开页面」）走 **network-first**。
 *    如果对 index.html 用 cache-first，发新版之后用户会永远拿到旧的 index.html，
 *    而它引用的还是旧 hash 的资源 —— 于是永远升不了级，且没有任何报错。
 *
 * ② 其余同源 GET 走 cache-first + 后台更新（stale-while-revalidate）。
 *    Vite 的产物都带 hash，内容变了文件名也跟着变，所以缓存住是安全的。
 *
 * 跨域请求一律直接放行到网络：api.github.com 是同步用的实时数据，
 * 缓存住就等于把用户锁在一份旧的仓库快照上，那是会丢东西的。
 */
const CACHE = 'suisui-shell-v1';

self.addEventListener('install', () => {
  // 不等旧页面关掉就接管，否则用户得开两次才生效
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('suisui-shell-') && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

/** 打开页面：优先要新的，连不上才回缓存里的壳 */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) await cache.put('/', res.clone());
    return res;
  } catch {
    const hit = (await cache.match('/')) || (await cache.match(req, { ignoreSearch: true }));
    return hit || offline();
  }
}

/** 静态资源：先给缓存（快），同时后台拉一份新的存着，下次打开就是新的 */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) {
    void fresh; // 后台更新，不阻塞本次返回
    return hit;
  }
  const res = await fresh;
  return res || offline();
}

function offline() {
  return new Response('离线了，而且这份内容还没缓存过。', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
