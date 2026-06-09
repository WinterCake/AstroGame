(function () {
  if (globalThis.__astroGameContentReady) return;
  globalThis.__astroGameContentReady = true;

  // --- Capture clics Attaquer ---
  function parseAttackCoordsFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (!url.pathname.includes("/game/fleetTable")) return null;
      if (url.searchParams.get("target_mission") !== "1") return null;
      const galaxy = url.searchParams.get("galaxy");
      const system = url.searchParams.get("system");
      const planet = url.searchParams.get("planet");
      if (!galaxy || !system || !planet) return null;
      return `${galaxy}:${system}:${planet}`;
    } catch {
      return null;
    }
  }

  function isAttackLink(link) {
    if (!link?.href) return false;
    return Boolean(parseAttackCoordsFromHref(link.href));
  }

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a");
      if (!isAttackLink(link)) return;
      const coords = parseAttackCoordsFromHref(link.href);
      if (!coords) return;
      chrome.runtime.sendMessage({ type: "MARK_ATTACKED", coords }, () => {
        void chrome.runtime.lastError;
      });
    },
    true
  );

  // --- Intercept AJAX rapports espionnage (messages) ---
  const SPY_SOURCE = "astrogame-spy-ext";

  if (!globalThis.__astroSpyInjectReady) {
    globalThis.__astroSpyInjectReady = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inject-spy.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SPY_SOURCE) return;
    if (event.data.type !== "SPY_MESSAGES_HTML") return;
    if (!event.data.html?.includes("ASTRO_SPY_REPORT_DATA")) return;

    chrome.runtime.sendMessage(
      {
        type: "SPY_PAGE_CAPTURE",
        html: event.data.html,
        url: event.data.url ?? location.href,
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });

  // --- Scrape rapports via onglet (Charger) ---
  if (!globalThis.__astroSpyScrapeReady) {
    globalThis.__astroSpyScrapeReady = true;

    function detectLoginPage(html) {
      if (html.includes("ASTRO_SPY_REPORT_DATA")) return false;
      return (
        /login|identifiant|mot de passe|password/i.test(html) &&
        !html.includes("messagestable")
      );
    }

    async function fetchSpyMessagesPageInTab(universe, page) {
      const url = `https://play.astrogame.org/${universe}/game/messages/view?messcat=0&site=${page}&ajax=1`;
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "text/html, */*",
        },
      });

      const html = await response.text();
      const reports = parseSpyReportsHtml(html);
      const withDetail = reports.filter((report) => report.spyData).length;

      return {
        page,
        status: response.status,
        ok: response.ok,
        htmlLength: html.length,
        hasSpyData: html.includes("ASTRO_SPY_REPORT_DATA"),
        isLogin: detectLoginPage(html),
        maxPage: detectMaxSpyPage(html),
        reports,
        withDetail,
        log: `p${page}: HTTP ${response.status}, ${html.length}o, ${reports.length} rapports, ${withDetail} détail`,
      };
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type !== "SCRAPE_SPY_PAGES") return false;

      (async () => {
        const logs = [];
        try {
          const universe =
            message.universe ||
            location.pathname.match(/\/(uni\d+)\//)?.[1] ||
            "uni24";

          logs.push(`Scrape via onglet ${universe}`);

          const first = await fetchSpyMessagesPageInTab(universe, 1);
          logs.push(first.log);

          if (!first.ok) throw new Error(`HTTP ${first.status} sur la page 1`);
          if (first.isLogin || (first.reports.length === 0 && !first.hasSpyData)) {
            throw new Error("Session Astrogame invalide — connecte-toi puis F5 sur l'onglet jeu");
          }

          const reports = [...first.reports];
          for (let page = 2; page <= first.maxPage; page++) {
            const result = await fetchSpyMessagesPageInTab(universe, page);
            logs.push(result.log);
            reports.push(...result.reports);
          }

          const withDetail = reports.filter((report) => report.spyData).length;
          logs.push(`Total: ${reports.length} rapports, ${withDetail} avec spyData`);

          sendResponse({
            ok: true,
            universe,
            reports,
            pagesScanned: first.maxPage,
            withDetail,
            total: reports.length,
            logs,
          });
        } catch (error) {
          logs.push(`Erreur: ${error.message}`);
          sendResponse({ ok: false, error: error.message, logs });
        }
      })();

      return true;
    });
  }
})();
