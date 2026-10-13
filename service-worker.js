const CACHE_PREFIX = "rinconcito-estudio-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-v1`;
const QUIZ_CACHE = `${CACHE_PREFIX}quizzes-v1`;
const APP_ROOT = new URL(self.registration.scope);
const QUIZ_DIRECTORY = new URL("Cuestionarios/", APP_ROOT).pathname;

const shellAssets = [
    "",
    "index.html",
    "manifest.webmanifest",
    "pwa.js",
    "Cuestionarios/estilos.css",
    "images/icons/icon-192x192.png",
    "images/icons/icon-512x512.png"
].map((path) => new URL(path, APP_ROOT).href);

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(shellAssets))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX)
                        && cacheName !== SHELL_CACHE
                        && cacheName !== QUIZ_CACHE)
                    .map((cacheName) => caches.delete(cacheName))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("message", (event) => {
    const replyPort = event.ports[0];
    if (!replyPort) return;

    event.waitUntil((async () => {
        try {
            const { action, url: requestedUrl } = event.data || {};
            const quizUrl = getQuizUrl(requestedUrl);

            if (action === "CHECK_QUIZ") {
                const cache = await caches.has(QUIZ_CACHE)
                    ? await caches.open(QUIZ_CACHE)
                    : null;
                replyPort.postMessage({ ok: true, cached: Boolean(cache && await cache.match(quizUrl)) });
                return;
            }

            const cache = await caches.open(QUIZ_CACHE);

            if (action === "CACHE_QUIZ") {
                const response = await fetch(quizUrl.href, { cache: "no-cache" });
                if (!response.ok) {
                    throw new Error(`El servidor respondió con estado ${response.status}.`);
                }
                await cache.put(quizUrl.href, response);
                replyPort.postMessage({ ok: true });
                return;
            }

            if (action === "REMOVE_QUIZ") {
                await cache.delete(quizUrl.href);
                if ((await cache.keys()).length === 0) {
                    await caches.delete(QUIZ_CACHE);
                }
                replyPort.postMessage({ ok: true });
                return;
            }

            throw new Error("La operación de acceso sin conexión no es válida.");
        } catch (error) {
            replyPort.postMessage({
                ok: false,
                error: error instanceof Error ? error.message : "Ocurrió un error inesperado."
            });
        }
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const requestUrl = new URL(request.url);

    if (request.method !== "GET" || requestUrl.origin !== APP_ROOT.origin) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            const quizCache = await caches.open(QUIZ_CACHE);
            const cachedQuiz = await quizCache.match(request, { ignoreSearch: true });
            let response;

            try {
                response = await fetch(request);
            } catch {
                return getOfflineResponse(requestUrl, cachedQuiz);
            }

            if (response.ok && isAppEntry(requestUrl)) {
                try {
                    const shellCache = await caches.open(SHELL_CACHE);
                    await shellCache.put(request, response.clone());
                } catch (error) {
                    console.error("No se pudo actualizar la copia sin conexión del menú:", error);
                }
            } else if (response.ok && cachedQuiz) {
                try {
                    await quizCache.put(request, response.clone());
                } catch (error) {
                    console.error("No se pudo actualizar la copia sin conexión del cuestionario:", error);
                }
            }

            return response;
        })());
        return;
    }

    event.respondWith((async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        return fetch(request);
    })());
});

function isAppEntry(url) {
    return url.pathname === APP_ROOT.pathname
        || url.pathname === new URL("index.html", APP_ROOT).pathname;
}

async function getOfflineResponse(requestUrl, cachedQuiz) {
    if (cachedQuiz) return cachedQuiz;

    const shellCache = await caches.open(SHELL_CACHE);
    const indexPage = await shellCache.match(new URL("index.html", APP_ROOT).href)
        || await shellCache.match(APP_ROOT.href);

    if (indexPage) {
        if (isAppEntry(requestUrl)) return indexPage;
        return Response.redirect(new URL("index.html", APP_ROOT).href);
    }

    return new Response("No hay conexión y el menú de estudio aún no está disponible sin conexión.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
}

function getQuizUrl(requestedUrl) {
    if (typeof requestedUrl !== "string") {
        throw new Error("No se indicó el cuestionario.");
    }

    const quizUrl = new URL(requestedUrl, APP_ROOT);
    if (quizUrl.origin !== APP_ROOT.origin
        || !quizUrl.pathname.startsWith(QUIZ_DIRECTORY)
        || !quizUrl.pathname.toLowerCase().endsWith(".html")) {
        throw new Error("El recurso solicitado no es un cuestionario válido.");
    }

    quizUrl.search = "";
    quizUrl.hash = "";
    return quizUrl;
}
