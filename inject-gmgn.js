/**
 * MAIN world on gmgn.ai.
 * History patch only on the hot path — do not wrap fetch.
 * Isolated world asks for holders/holdings via postMessage.
 */
(function () {
  const INST = Symbol.for("dirtover.gmgn");
  if (globalThis[INST]) return;
  globalThis[INST] = true;

  const CHANNEL = "dirtover";
  const origFetch = window.fetch.bind(window);
  const harvested = {};
  const holdersCache = new Map();

  let navTimer = 0;
  const fireNav = () => {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      try {
        window.dispatchEvent(new Event("dirtover-nav"));
      } catch {
        /* ignore */
      }
    }, 40);
  };

  const wrapHist = (fn) =>
    function patched() {
      const ret = fn.apply(this, arguments);
      fireNav();
      return ret;
    };

  history.pushState = wrapHist(history.pushState);
  history.replaceState = wrapHist(history.replaceState);
  window.addEventListener("popstate", fireNav);

  function harvest(url) {
    try {
      const u = new URL(url, location.href);
      if (u.hostname !== "gmgn.ai") return;
      if (!/\/(vas|defi|api)\//.test(u.pathname)) return;
      for (const [k, v] of u.searchParams) {
        if (/device|fp_|client|app_ver|from_app|tz_|lang|os_|uuid|did|cid/i.test(k) && v) {
          harvested[k] = v;
        }
      }
    } catch {
      /* ignore */
    }
  }

  function harvestFromPerf() {
    try {
      for (const e of performance.getEntriesByType("resource")) harvest(e.name);
    } catch {
      /* ignore */
    }
  }

  function withHarvested(url) {
    try {
      const u = new URL(url, location.origin);
      for (const [k, v] of Object.entries(harvested)) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  async function gmgnGet(path, extra) {
    harvestFromPerf();
    const u = new URL(path, location.origin);
    for (const [k, v] of Object.entries(harvested)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    for (const [k, v] of Object.entries(extra || {})) {
      if (v != null && v !== "") u.searchParams.set(k, String(v));
    }
    const res = await origFetch(withHarvested(u.toString()), {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`gmgn ${res.status}`);
    const body = await res.json();
    if (body && body.code != null && Number(body.code) !== 0) {
      throw new Error(body.message || body.msg || `gmgn ${body.code}`);
    }
    return body;
  }

  async function firstOk(jobs) {
    let last = new Error("empty");
    for (const job of jobs) {
      try {
        return await job();
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  async function fetchHolders(chain, token, force) {
    const key = `${String(chain || "").toLowerCase()}:${token}`;
    const hit = holdersCache.get(key);
    if (!force && hit && Date.now() - hit.ts < 6000) return hit.body;
    const body = await firstOk([
      () =>
        gmgnGet(`/vas/api/v1/token_holders/${chain}/${token}`, {
          limit: 100,
          cost: 20,
          orderby: "amount_percentage",
          direction: "desc",
        }),
      () =>
        gmgnGet(`/defi/quotation/v1/tokens/top_holders/${chain}/${token}`, {
          limit: 100,
          orderby: "amount_percentage",
          direction: "desc",
        }),
    ]);
    holdersCache.set(key, { ts: Date.now(), body });
    return body;
  }

  async function fetchWallet(chain, wallet, token) {
    return firstOk([
      () =>
        gmgnGet(`/vas/api/v1/wallet_holdings/${chain}/${wallet}`, {
          limit: 50,
          token,
          keyword: token,
          showsmall: "true",
          hide_small: "false",
          hide_abnormal: "false",
          hide_airdrop: "false",
          orderby: "usd_value",
          direction: "desc",
        }),
      () =>
        gmgnGet(`/vas/api/v1/wallet_holdings/${chain}/${wallet}`, {
          limit: 80,
          showsmall: "true",
          hide_small: "false",
          hide_abnormal: "false",
          hide_airdrop: "false",
          orderby: "usd_value",
          direction: "desc",
        }),
    ]);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.channel !== CHANNEL || d.dir !== "to-page") return;
    const requestId = d.requestId;
    const reply = (payload) => {
      window.postMessage({ channel: CHANNEL, dir: "from-page", type: "REPLY", requestId, payload }, "*");
    };

    if (d.type === "PING") {
      reply({ ok: true });
      return;
    }

    if (d.type === "HOLDERS") {
      fetchHolders(d.chain, d.token, Boolean(d.force))
        .then((body) => reply({ ok: true, body }))
        .catch((err) => reply({ ok: false, error: String(err && err.message ? err.message : err) }));
      return;
    }

    if (d.type === "WALLET") {
      fetchWallet(d.chain, d.wallet, d.token)
        .then((body) => reply({ ok: true, body }))
        .catch((err) => reply({ ok: false, error: String(err && err.message ? err.message : err) }));
    }
  });
})();
