function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
}

export function initPwaApp({ root = document, navigatorRef = navigator } = {}) {
  const card = root.querySelector("#pwa-install-card");
  const status = root.querySelector("#pwa-install-status");
  if (!card || !status) return () => {};

  let installPrompt = null;
  let registration = null;

  const setCard = ({ ready = false, text, disabled = false }) => {
    card.classList.toggle("pwa-ready", ready);
    card.disabled = disabled;
    status.textContent = text;
  };

  const refreshState = () => {
    if (registration?.waiting) {
      setCard({ ready: true, text: "有新版本，点这里更新网页" });
      return;
    }
    if (isStandalone()) {
      setCard({ ready: false, text: "已像 App 一样打开" });
      return;
    }
    if (installPrompt) {
      setCard({ ready: true, text: "点这里添加到手机桌面" });
      return;
    }
    setCard({ ready: false, text: "可在浏览器菜单里添加到桌面" });
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshState();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    setCard({ ready: false, text: "已添加到桌面" });
  });

  navigatorRef.serviceWorker?.ready?.then((readyRegistration) => {
    registration = readyRegistration;
    refreshState();
    registration.addEventListener?.("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener?.("statechange", () => {
        if (worker.state === "installed" && navigatorRef.serviceWorker.controller) {
          refreshState();
        }
      });
    });
  }).catch(() => {});

  navigatorRef.serviceWorker?.addEventListener?.("controllerchange", () => window.location.reload());

  card.addEventListener("click", async () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    if (!installPrompt) {
      refreshState();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    refreshState();
  });

  refreshState();
  return refreshState;
}
