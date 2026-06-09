(function () {
  const SOURCE = "astrogame-galaxy-ext";

  function isGalaxyAjax(url) {
    return typeof url === "string" && url.includes("galaxy/ajax");
  }

  function emit(payload) {
    window.postMessage({ source: SOURCE, type: "GALAXY_AJAX", payload }, "*");
  }

  function tryEmitResponse(text) {
    try {
      const data = JSON.parse(text);
      if (data?.status && data.existsPlanets) {
        emit(data);
      }
    } catch {
      // ignore non-json responses
    }
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._astroGalaxyUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isGalaxyAjax(this._astroGalaxyUrl)) {
      this.addEventListener("load", function () {
        tryEmitResponse(this.responseText);
      });
    }
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const response = await originalFetch.apply(this, arguments);

    if (isGalaxyAjax(url)) {
      try {
        const clone = response.clone();
        tryEmitResponse(await clone.text());
      } catch {
        // ignore
      }
    }

    return response;
  };
})();
