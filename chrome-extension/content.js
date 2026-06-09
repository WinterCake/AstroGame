const SOURCE = "astrogame-galaxy-ext";

function injectInterceptor() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function showToast(message) {
  const ensureToast = () => {
    let toast = document.getElementById("astrogame-galaxy-toast");
    if (toast) return toast;

    toast = document.createElement("div");
    toast.id = "astrogame-galaxy-toast";
    toast.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "z-index:999999",
      "padding:10px 14px",
      "border-radius:8px",
      "background:rgba(12,18,32,0.92)",
      "color:#8fd3ff",
      "font:600 13px/1.4 Montserrat,Arial,sans-serif",
      "border:1px solid rgba(79,163,255,0.35)",
      "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
      "pointer-events:none",
      "transition:opacity .25s ease",
    ].join(";");
    (document.body || document.documentElement).appendChild(toast);
    return toast;
  };

  if (!document.body) return;
  const toast = ensureToast();
  toast.textContent = message;
  toast.style.opacity = "1";

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 2200);
}

injectInterceptor();

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== SOURCE) return;
  if (event.data.type !== "GALAXY_AJAX") return;

  chrome.runtime.sendMessage(
    { type: "GALAXY_DATA", payload: event.data.payload },
    (response) => {
      if (chrome.runtime.lastError) return;

      if (response?.skipped) {
        showToast("Capture en pause");
        return;
      }

      if (response?.ok) {
        const { systemsStored, planetEntries, lastScanned, attackableInactivePlanets } = response.meta;
        const inactivePart =
          attackableInactivePlanets > 0 ? ` — ${attackableInactivePlanets} inactif(s)` : "";
        showToast(`✓ ${lastScanned} — ${planetEntries} planètes (${systemsStored} syst.)${inactivePart}`);
      }
    }
  );
});
