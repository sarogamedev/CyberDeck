// Bump this on every client release. The previous value was a fixed
// 'cyberdeck-shell-v1' combined with a cache-first strategy, which pinned every
// existing install to the first HTML and JS it ever cached. No client fix,
// security or otherwise, could reach a user who had loaded the app once.
const CACHE_VERSION = 'v2-2026-09-09';
const CACHE_NAME = `cyberdeck-shell-${CACHE_VERSION}`;

// Every script index.html actually loads. The old list named eight of the
// nineteen module files, so offline the app booted half-wired.
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/style.css',
    '/img/logo.png',
    '/lib/jsQR.min.js',
    '/lib/qrcode.min.js',
    '/js/app.js',
    '/js/chat.js',
    '/js/dashboard.js',
    '/js/dtn.js',
    '/js/ebooks.js',
    '/js/llm.js',
    '/js/maps.js',
    '/js/mesh.js',
    '/js/music.js',
    '/js/nearby.js',
    '/js/p2p.js',
    '/js/photos.js',
    '/js/power.js',
    '/js/store.js',
    '/js/survival.js',
    '/js/utilities.js',
    '/js/vault.js',
    '/js/videos.js',
    '/js/wiki.js'
    // API responses, media streams and anything authenticated stay out.
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // addAll fails the whole install if any single asset 404s. Add
        // individually so one missing file cannot block the update.
        await Promise.all(ASSETS_TO_CACHE.map(async (url) => {
            try {
                await cache.add(new Request(url, { cache: 'reload' }));
            } catch (err) {
                console.warn('[SW] Could not precache', url, err);
            }
        }));
        // Inside waitUntil, so activation does not race the precache.
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(
            names
                .filter(name => name.startsWith('cyberdeck-shell-') && name !== CACHE_NAME)
                .map(name => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

/** Never persist anything that is authenticated or user-specific. */
function isCacheable(request, response) {
    if (!response || response.status !== 200 || response.type !== 'basic') return false;
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return false;
    if (url.pathname.startsWith('/admin')) return false;
    // Media and tile URLs carry a short-lived token; caching them would write
    // a credential to disk under a cache key that includes it.
    if (url.searchParams.has('token')) return false;
    if (response.headers.get('Vary')?.includes('Authorization')) return false;
    return true;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return; // Let it go straight to the network.

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // API calls are always live.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request));
        return;
    }

    // Navigations: network first, so a new shell is picked up as soon as the
    // server is reachable, with the cached shell as the offline fallback.
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                if (isCacheable(request, fresh)) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(request, fresh.clone());
                }
                return fresh;
            } catch (err) {
                const cached = await caches.match(request) || await caches.match('/index.html');
                // Returning undefined from the old .catch produced a network
                // error rather than an offline page.
                return cached || new Response(
                    '<h1>Offline</h1><p>CyberDeck is not reachable and no cached copy is available.</p>',
                    { status: 503, headers: { 'Content-Type': 'text/html' } }
                );
            }
        })());
        return;
    }

    // Static assets: cache first, refreshed in the background.
    event.respondWith((async () => {
        const cached = await caches.match(request);
        const network = fetch(request).then(async (response) => {
            if (isCacheable(request, response)) {
                const cache = await caches.open(CACHE_NAME);
                cache.put(request, response.clone());
            }
            return response;
        }).catch(() => null);

        if (cached) {
            event.waitUntil(network); // Revalidate without blocking.
            return cached;
        }

        const fresh = await network;
        return fresh || new Response('', { status: 504, statusText: 'Offline' });
    })());
});
