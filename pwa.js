(() => {
    const scriptUrl = document.currentScript.src;
    const appRoot = new URL("./", scriptUrl);
    const serviceWorkerUrl = new URL("service-worker.js", appRoot);
    const offlineButton = document.querySelector("#offline-toggle");
    const offlineStatus = document.querySelector("#offline-status");
    const installDialog = document.querySelector("#install-dialog");
    const installButton = document.querySelector("#install-app-button");
    const installDescription = document.querySelector("#install-description");
    const installCloseButton = document.querySelector("#install-close-button");
    const installDismissalKey = "rinconcito-install-dismissed-v1";
    let deferredInstallPrompt = null;
    const serviceWorkerPromise = registerServiceWorker();

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        if (isAppleMobileDevice()) return;

        deferredInstallPrompt = event;
        if (installButton) {
            installButton.textContent = "Instalar en Chrome";
            installButton.dataset.action = "install";
        }
        if (installDescription) {
            installDescription.textContent = "Instálala desde Chrome para abrir tus cuestionarios y usarlos sin conexión.";
        }
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        sessionStorage.removeItem(installDismissalKey);
        if (installDialog?.open) installDialog.close();
    });

    async function registerServiceWorker() {
        if (!("serviceWorker" in navigator) || !window.isSecureContext) {
            if (offlineButton) {
                offlineButton.disabled = true;
                offlineStatus.textContent = "El acceso sin conexión requiere HTTPS (por ejemplo, GitHub Pages).";
            }
            return null;
        }

        const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href, {
            scope: appRoot.pathname
        });

        let timeoutId;
        try {
            const worker = await Promise.race([
                navigator.serviceWorker.ready.then((readyRegistration) => readyRegistration.active),
                new Promise((_, reject) => {
                    timeoutId = window.setTimeout(
                        () => reject(new Error("El service worker tardó demasiado en activarse.")),
                        15000
                    );
                })
            ]);
            return worker || registration.active;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function sendWorkerMessage(worker, message) {
        return new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => {
                channel.port1.close();
                reject(new Error("No hubo respuesta del gestor de acceso sin conexión."));
            }, 30000);

            channel.port1.onmessage = ({ data }) => {
                window.clearTimeout(timeout);
                channel.port1.close();
                if (!data || !data.ok) {
                    reject(new Error(data?.error || "No se pudo completar la operación."));
                    return;
                }
                resolve(data);
            };

            worker.postMessage(message, [channel.port2]);
        });
    }

    async function updateOfflineButton(worker) {
        const quizUrl = new URL(offlineButton.dataset.offlineUrl, window.location.href);
        const { cached } = await sendWorkerMessage(worker, {
            action: "CHECK_QUIZ",
            url: quizUrl.href
        });

        offlineButton.dataset.action = cached ? "REMOVE_QUIZ" : "CACHE_QUIZ";
        offlineButton.textContent = cached
            ? "Quitar acceso sin conexión"
            : "Preparar para usar sin conexión";
        offlineStatus.textContent = cached
            ? "Este cuestionario está guardado y disponible sin conexión."
            : "Este cuestionario aún no está guardado para usar sin conexión.";
    }

    async function initializeOfflineButton() {
        if (!offlineButton || !offlineStatus) return;

        if (!("serviceWorker" in navigator) || !window.isSecureContext) {
            offlineButton.disabled = true;
            offlineStatus.textContent = "El acceso sin conexión requiere HTTPS (por ejemplo, GitHub Pages).";
            return;
        }

        offlineButton.disabled = true;
        offlineStatus.textContent = "Comprobando el acceso sin conexión...";

        try {
            const worker = await serviceWorkerPromise;
            if (!worker) return;
            await updateOfflineButton(worker);

            offlineButton.addEventListener("click", async () => {
                const action = offlineButton.dataset.action;
                const quizUrl = new URL(offlineButton.dataset.offlineUrl, window.location.href);
                offlineButton.disabled = true;
                offlineStatus.textContent = action === "CACHE_QUIZ"
                    ? "Guardando el cuestionario para usarlo sin conexión..."
                    : "Quitando el cuestionario guardado...";

                try {
                    await sendWorkerMessage(worker, { action, url: quizUrl.href });
                    await updateOfflineButton(worker);
                } catch (error) {
                    offlineStatus.textContent = `No se pudo actualizar el acceso sin conexión: ${error.message}`;
                } finally {
                    offlineButton.disabled = false;
                }
            });
            offlineButton.disabled = false;
        } catch (error) {
            offlineButton.disabled = true;
            offlineStatus.textContent = `No se pudo iniciar el acceso sin conexión: ${error.message}`;
        }
    }

    function isAppInstalled() {
        return window.matchMedia("(display-mode: standalone)").matches
            || window.matchMedia("(display-mode: fullscreen)").matches
            || navigator.standalone === true;
    }

    function isAppleMobileDevice() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent)
            || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function isDesktopChrome() {
        return /Chrome\//.test(navigator.userAgent)
            && !/(Edg|OPR|CriOS)\//.test(navigator.userAgent)
            && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
            && !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function showInstallInstructions() {
        if (!window.isSecureContext) {
            installDescription.textContent = "Para instalarla y habilitar el acceso sin conexión, abre esta página desde una dirección HTTPS, como GitHub Pages.";
        } else if (isAppleMobileDevice()) {
            installDescription.textContent = "En iPhone o iPad, abre esta página en Safari. Toca Compartir y selecciona “Añadir a pantalla de inicio”; después confirma con “Añadir”.";
        } else if (isDesktopChrome()) {
            installDescription.textContent = "En Chrome, usa el icono de instalar que aparece al final de la barra de direcciones. Si no aparece, abre ⋮ y elige “Instalar aplicación” o “Instalar página como aplicación”.";
        } else {
            installDescription.textContent = "Abre el menú de tu navegador y elige “Instalar aplicación” o “Añadir a pantalla de inicio” para usarla sin conexión.";
        }

        installButton.textContent = "Entendido";
        installButton.dataset.action = "close";
    }

    function initializeInstallPrompt() {
        if (!installDialog || !installButton || !installDescription || !installCloseButton) return;
        if (isAppInstalled() || sessionStorage.getItem(installDismissalKey) === "true") return;

        if (deferredInstallPrompt) {
            installButton.textContent = "Instalar aplicación";
            installButton.dataset.action = "install";
        } else if (isAppleMobileDevice()) {
            installDescription.textContent = "En iPhone o iPad, abre esta página en Safari y agrégala a la pantalla de inicio para usarla sin conexión.";
            installButton.textContent = "Cómo instalar en Safari";
            installButton.dataset.action = "show-instructions";
        } else if (isDesktopChrome()) {
            installDescription.textContent = "Instala la aplicación en Chrome para abrir tus cuestionarios y usarlos sin conexión.";
            installButton.textContent = "Instalar en Chrome";
            installButton.dataset.action = "show-instructions";
        } else {
            installButton.dataset.action = "show-instructions";
        }

        installDialog.addEventListener("close", () => {
            if (!isAppInstalled()) sessionStorage.setItem(installDismissalKey, "true");
        });

        installCloseButton.addEventListener("click", () => installDialog.close());
        installButton.addEventListener("click", async () => {
            if (!deferredInstallPrompt) {
                if (installButton.dataset.action === "close") {
                    installDialog.close();
                } else {
                    showInstallInstructions();
                }
                return;
            }

            installButton.disabled = true;
            try {
                const installPrompt = deferredInstallPrompt;
                deferredInstallPrompt = null;
                await installPrompt.prompt();
                const { outcome } = await installPrompt.userChoice;
                if (outcome === "accepted") {
                    sessionStorage.removeItem(installDismissalKey);
                    installDialog.close();
                } else {
                    showInstallInstructions();
                }
            } catch (error) {
                installDescription.textContent = `No se pudo iniciar la instalación: ${error.message}`;
                showInstallInstructions();
            } finally {
                installButton.disabled = false;
            }
        });

        installDialog.showModal();
    }

    serviceWorkerPromise.catch((error) => {
        console.error("No se pudo registrar el service worker:", error);
    });
    initializeInstallPrompt();
    initializeOfflineButton();
})();
