(function () {
  const SOURCE = "astrogame-spy-ext";

  function isSpyMessagesAjax(url) {
    return (
      typeof url === "string" &&
      url.includes("messages/view") &&
      (url.includes("messcat=0") || url.includes("messcat%3D0"))
    );
  }

  function emit(html, url) {
    window.postMessage({ source: SOURCE, type: "SPY_MESSAGES_HTML", html, url }, "*");
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._astroSpyUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isSpyMessagesAjax(this._astroSpyUrl)) {
      this.addEventListener("load", function () {
        if (typeof this.responseText === "string" && this.responseText.includes("ASTRO_SPY_REPORT_DATA")) {
          emit(this.responseText, this._astroSpyUrl);
        }
      });
    }
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const response = await originalFetch.apply(this, arguments);

    if (isSpyMessagesAjax(url)) {
      try {
        const clone = response.clone();
        const text = await clone.text();
        if (text.includes("ASTRO_SPY_REPORT_DATA")) {
          emit(text, url);
        }
      } catch {
        // ignore
      }
    }

    return response;
  };
})();
