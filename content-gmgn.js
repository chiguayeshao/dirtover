const CHIP_ID = "dirtover-chip";
const TIP_ID = "dirtover-tip";
const HOLD_ID = "holdover-chip";
const TOKEN_RE = /^\/(robinhood|sol|bsc|base|eth|monad)\/token\/([^/?#]+)/i;
const CHANNEL = "dirtover";
const REFRESH_MS = 8_000;
const MAX_WALLETS = 60;
const TIP_VISIBLE = 10;
const REFRESH_SVG =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 6.1 4.2.75.75 0 1 0-1.4-.5 5 5 0 1 1-1.32-1.7h-1.13a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 .75-.75v-3a.75.75 0 0 0-1.5 0v1.04A6.48 6.48 0 0 0 8 1.5z"/></svg>';

const HEAT = [
  { max: 0, heat: "h0", label: "0% 干净", color: "#3f8f5b", bg: "rgba(63,143,91,0.16)" },
  { max: 2, heat: "h2", label: "0–2% 痕迹", color: "#8a8f3d", bg: "rgba(138,143,61,0.18)" },
  { max: 5, heat: "h5", label: "2–5% 轻污", color: "#b59a1c", bg: "rgba(181,154,28,0.20)" },
  { max: 10, heat: "h10", label: "5–10% 不对", color: "#c47a14", bg: "rgba(196,122,20,0.22)" },
  { max: 15, heat: "h15", label: "10–15% 脏", color: "#c45a22", bg: "rgba(196,90,34,0.22)" },
  { max: 20, heat: "h20", label: "15–20% 很脏", color: "#b83a32", bg: "rgba(184,58,50,0.24)" },
  { max: 30, heat: "h30", label: "20–30% 毒仓", color: "#9b1d32", bg: "rgba(155,29,50,0.26)" },
  { max: Infinity, heat: "h30p", label: "≥30% 撤离", color: "#ff2d4a", bg: "rgba(32,8,12,0.88)" },
];

let list = [];
let rowObs = null;
let retryTimer = 0;
let retryLeft = 0;
let refreshTimer = 0;
let lastKey = "";
let lastPaintKey = "";
let lastText = "";
let lastState = "";
let lastExtra = "";
let lastPct = null;
let lastRows = [];
let lastBound = false;
let reqGen = 0;
let askKey = "";
let askAt = 0;
let tipHideTimer = 0;
const pending = new Map();

function ensureSpinStyle() {
  if (document.getElementById("dirtover-spin-style")) return;
  const style = document.createElement("style");
  style.id = "dirtover-spin-style";
  style.textContent =
    "@keyframes dirtover-spin{to{transform:rotate(360deg)}}" +
    "[data-dirtover-refresh]{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;margin-left:1px;padding:0;border:0;background:transparent;color:inherit;opacity:.72;cursor:pointer;line-height:0}" +
    "[data-dirtover-refresh]:hover{opacity:1}" +
    "[data-dirtover-refresh][data-spin='1']{animation:dirtover-spin .7s linear infinite}" +
    `#dirtover-tip{position:fixed;z-index:2147483646;display:none;min-width:148px;max-width:280px;max-height:calc(16px + 22px * ${TIP_VISIBLE});overflow:auto;overscroll-behavior:contain;padding:8px 10px;border-radius:6px;background:#1c1714;color:#f3ece6;font:12px/22px ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:auto}` +
    "#dirtover-tip[data-open='1']{display:block}" +
    "#dirtover-tip::before{content:'';position:absolute;left:0;right:0;top:-8px;height:8px}" +
    "#dirtover-tip div{display:flex;align-items:center;justify-content:space-between;gap:16px;height:22px;white-space:nowrap}" +
    "#dirtover-tip b{min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis}" +
    "#dirtover-tip em{font-style:normal;font-variant-numeric:tabular-nums;flex:0 0 auto;color:#e8c4b0}";
  document.documentElement.appendChild(style);
}

function setChipSpin(chip, on) {
  const btn = chip && chip.querySelector("[data-dirtover-refresh]");
  if (btn) btn.dataset.spin = on ? "1" : "";
}

function parseToken(href = location.href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const m = u.pathname.match(TOKEN_RE);
  if (!m) return null;
  let address = decodeURIComponent(m[2] || "").trim();
  if (!address) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) address = address.toLowerCase();
  return { gmgnChain: m[1].toLowerCase(), address };
}

function tokenKey(token) {
  if (!token) return "";
  return `${token.gmgnChain}:${token.address}`;
}

function normAddr(s) {
  const v = String(s || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(v)) return v.toLowerCase();
  return v;
}

function isAddr(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function formatPct(pct, lowerBound) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0) return "—";
  let body;
  if (n === 0) body = "0%";
  else if (n < 0.1) body = "<0.1%";
  else if (n < 10) body = `${n.toFixed(1).replace(/\.0$/, "")}%`;
  else body = `${Math.round(n)}%`;
  return lowerBound ? `~${body}` : body;
}

function themeFor(pct, state) {
  if (state === "load") {
    return { heat: "load", label: "读取中", color: "#8a6a4a", bg: "rgba(138,106,74,0.16)" };
  }
  if (state === "dash") {
    return { heat: "void", label: "无数据", color: "#8b93a7", bg: "rgba(139,147,167,0.14)" };
  }
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return HEAT[0];
  for (const band of HEAT) {
    if (band.max === 0) continue;
    if (n < band.max) return band;
  }
  return HEAT[HEAT.length - 1];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tipLabel(row) {
  const note = String(row && row.note ? row.note : "").trim();
  return note || shortAddr(row && row.address);
}

function hideTip() {
  clearTimeout(tipHideTimer);
  tipHideTimer = 0;
  const tip = document.getElementById(TIP_ID);
  if (tip) tip.dataset.open = "";
}

function scheduleHideTip() {
  clearTimeout(tipHideTimer);
  tipHideTimer = setTimeout(hideTip, 180);
}

function cancelHideTip() {
  clearTimeout(tipHideTimer);
  tipHideTimer = 0;
}

function sortTipRows(rows) {
  return (rows || [])
    .filter((r) => Number(r.pct) > 0)
    .sort((a, b) => {
      const d = (Number(b.pct) || 0) - (Number(a.pct) || 0);
      if (d) return d;
      return tipLabel(a).localeCompare(tipLabel(b), "zh");
    });
}

function placeTip(chip) {
  const tip = document.getElementById(TIP_ID);
  if (!tip || !chip || tip.dataset.open !== "1") return;
  const r = chip.getBoundingClientRect();
  const pad = 8;
  const width = tip.offsetWidth || 160;
  let left = r.left;
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
  if (left < pad) left = pad;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(r.bottom + 4)}px`;
}

function bindTipLayer(tip) {
  if (tip.dataset.bound === "1") return;
  tip.dataset.bound = "1";
  tip.addEventListener("mouseenter", cancelHideTip);
  tip.addEventListener("mouseleave", scheduleHideTip);
  tip.addEventListener(
    "wheel",
    (event) => {
      event.stopPropagation();
      const max = tip.scrollHeight - tip.clientHeight;
      if (max <= 0) return;
      event.preventDefault();
      tip.scrollTop = Math.max(0, Math.min(max, tip.scrollTop + event.deltaY));
    },
    { passive: false }
  );
}

function showTip(chip, rows) {
  ensureSpinStyle();
  let tip = document.getElementById(TIP_ID);
  if (!tip) {
    tip = document.createElement("div");
    tip.id = TIP_ID;
    document.documentElement.appendChild(tip);
  }
  bindTipLayer(tip);
  const listRows = sortTipRows(rows || lastRows);
  if (!listRows.length) {
    hideTip();
    return;
  }
  const html = listRows
    .map((r) => `<div><b>${escapeHtml(tipLabel(r))}</b><em>${escapeHtml(formatPct(r.pct))}</em></div>`)
    .join("");
  const sig = listRows.map((r) => `${r.address}:${r.pct}:${r.note || ""}`).join("|");
  if (tip.dataset.open !== "1" || tip.dataset.sig !== sig) {
    tip.innerHTML = html;
    tip.dataset.sig = sig;
  }
  tip.dataset.open = "1";
  cancelHideTip();
  placeTip(chip);
}

function bindTip(chip) {
  if (chip.dataset.tipBound === "1") return;
  chip.dataset.tipBound = "1";
  chip.addEventListener("mouseenter", () => {
    cancelHideTip();
    showTip(chip, lastRows);
  });
  chip.addEventListener("mouseleave", scheduleHideTip);
}

function shortAddr(addr) {
  const a = String(addr || "");
  if (a.length < 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function applyChip(chip, text, state, titleExtra, pct, rows) {
  const val = chip.querySelector("[data-dirtover-val]");
  if (val) val.textContent = text;
  const theme = themeFor(pct, state);
  chip.dataset.state = state;
  chip.dataset.heat = theme.heat;
  chip.style.color = theme.color;
  chip.style.background = theme.bg;
  chip.style.opacity = state === "dash" ? "0.55" : "1";
  chip.removeAttribute("title");
  bindTip(chip);
  const tip = document.getElementById(TIP_ID);
  if (tip && tip.dataset.open === "1") showTip(chip, rows || lastRows);
}

function makeChip() {
  ensureSpinStyle();
  const chip = document.createElement("div");
  chip.id = CHIP_ID;
  chip.dataset.dirtover = "1";
  chip.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:3px",
    "height:16px",
    "padding:0 5px",
    "border-radius:3px",
    "font-size:12px",
    "font-weight:500",
    "line-height:16px",
    "white-space:nowrap",
    "flex-shrink:0",
    "color:#8a6a4a",
    "background:rgba(138,106,74,0.16)",
    "cursor:default",
    "user-select:none",
  ].join(";");
  chip.innerHTML = `<span>畜生</span><span data-dirtover-val>…</span><button type="button" data-dirtover-refresh title="立刻刷新畜生" aria-label="立刻刷新畜生">${REFRESH_SVG}</button>`;
  chip.addEventListener("click", (event) => {
    if (!event.target.closest("[data-dirtover-refresh]")) return;
    event.preventDefault();
    event.stopPropagation();
    manualRefresh();
  });
  applyChip(chip, "…", "load", "", null, []);
  return chip;
}

function findHoldoverInsert() {
  const addr = document.getElementById("token-base-address");
  if (!addr) return null;
  const row =
    addr.closest(".flex.items-center.gap-x-8px") ||
    addr.closest('[class*="gap-x-8px"]') ||
    addr.parentElement?.parentElement;
  if (!row) return null;

  const devIcon = row.querySelector('[data-icon="IconDev16pxRegular"]');
  if (devIcon) {
    let block = devIcon.parentElement;
    while (block && block !== row && block.parentElement !== row) {
      block = block.parentElement;
    }
    if (block && block.parentElement === row) {
      return { parent: row, before: block };
    }
  }

  const caWrap =
    addr.closest(".flex.items-center.cursor-pointer") ||
    addr.parentElement;
  if (caWrap?.parentElement) {
    return { parent: caWrap.parentElement, before: caWrap.nextElementSibling };
  }
  return { parent: row, before: addr.nextElementSibling };
}

function findInsert() {
  const hold = document.getElementById(HOLD_ID);
  if (hold?.parentElement) {
    return { parent: hold.parentElement, before: hold.nextElementSibling };
  }
  return findHoldoverInsert();
}

function placeChip() {
  const spot = findInsert();
  if (!spot) return null;
  let chip = document.getElementById(CHIP_ID);
  const already =
    chip &&
    chip.parentElement === spot.parent &&
    (spot.before ? chip.nextElementSibling === spot.before : chip.nextElementSibling == null);
  if (already) return chip;
  if (!chip) chip = makeChip();
  spot.parent.insertBefore(chip, spot.before);
  watchRow(spot.parent);
  return chip;
}

function watchRow(row) {
  if (rowObs) {
    rowObs.disconnect();
    rowObs = null;
  }
  if (!row) return;
  rowObs = new MutationObserver(() => {
    if (document.getElementById(CHIP_ID)) return;
    if (!parseToken()) return;
    queueMicrotask(() => {
      const chip = placeChip();
      if (chip && lastPaintKey) restoreLast(chip);
    });
  });
  rowObs.observe(row, { childList: true });
}

function restoreLast(chip) {
  if (lastPaintKey && lastText) {
    applyChip(chip, lastText, lastState || "ok", lastExtra, lastPct, lastRows);
  }
}

function clearRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = 0;
}

function armRefresh() {
  clearRefresh();
  if (document.hidden || !parseToken()) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    const token = parseToken();
    if (!token || document.hidden) return;
    requestHold(token, false, "timer");
    armRefresh();
  }, REFRESH_MS);
}

function teardown() {
  clearTimeout(retryTimer);
  clearRefresh();
  retryLeft = 0;
  lastKey = "";
  lastPaintKey = "";
  lastText = "";
  lastState = "";
  lastExtra = "";
  lastPct = null;
  lastRows = [];
  lastBound = false;
  reqGen += 1;
  rowObs?.disconnect();
  rowObs = null;
  hideTip();
  document.getElementById(TIP_ID)?.remove();
  document.getElementById(CHIP_ID)?.remove();
}

function rememberOk(pct, extra, rows, lowerBound) {
  const text = formatPct(pct, lowerBound);
  lastPct = pct;
  lastText = text;
  lastState = "ok";
  lastExtra = extra;
  lastRows = rows;
  lastBound = Boolean(lowerBound);
  lastPaintKey = lastKey;
  return { text, extra };
}

function paint(res, token) {
  if (!token || tokenKey(token) !== lastKey) return;

  if (res?.ok && Number.isFinite(Number(res.pct))) {
    const saved = rememberOk(Number(res.pct), res.extra || "", res.rows || [], res.lowerBound);
    const chip = document.getElementById(CHIP_ID) || placeChip();
    if (chip) {
      setChipSpin(chip, false);
      applyChip(chip, saved.text, "ok", saved.extra, lastPct, lastRows);
    }
    armRefresh();
    return;
  }

  const chip = document.getElementById(CHIP_ID) || placeChip();
  if (!chip) return;
  setChipSpin(chip, false);

  if (lastPaintKey === lastKey && lastText && lastState !== "dash") {
    applyChip(chip, lastText, lastState, lastExtra, lastPct, lastRows);
    armRefresh();
    return;
  }

  lastText = "—";
  lastState = "dash";
  lastExtra = res?.error || "";
  lastPct = null;
  lastRows = [];
  applyChip(chip, lastText, lastState, lastExtra, null, []);
  lastPaintKey = lastKey;
  armRefresh();
}

function callPage(type, payload, timeoutMs) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(requestId, (res) => {
      clearTimeout(t);
      resolve(res);
    });
    window.postMessage({ channel: CHANNEL, dir: "to-page", type, requestId, ...payload }, "*");
  });
}

function asList(body) {
  if (!body) return [];
  const d = body.data != null ? body.data : body;
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  for (const k of ["list", "holders", "holdings", "tokens", "items", "rank"]) {
    if (Array.isArray(d[k])) return d[k];
  }
  return [];
}

function pickPct(item) {
  if (!item || typeof item !== "object") return null;
  const v =
    item.amount_percentage ??
    item.amountPercentage ??
    item.percentage ??
    item.hold_percent ??
    item.hold_rate;
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n : n * 100;
}

function pickWallet(item) {
  if (!item || typeof item !== "object") return "";
  for (const c of [item.address, item.wallet_address, item.account_address, item.wallet, item.owner, item.maker]) {
    if (isAddr(String(c || ""))) return normAddr(c);
  }
  return "";
}

function pickToken(item) {
  if (!item || typeof item !== "object") return "";
  const t = item.token && typeof item.token === "object" ? item.token : null;
  for (const c of [item.token_address, item.address, t && t.address, t && t.token_address]) {
    if (isAddr(String(c || ""))) return normAddr(c);
  }
  return "";
}

function extractHolderRows(body) {
  const rows = [];
  for (const item of asList(body)) {
    const address = pickWallet(item);
    const pct = pickPct(item);
    if (!address || pct == null) continue;
    rows.push({ address, pct });
  }
  return rows;
}

function extractHoldingPct(body, token) {
  const want = normAddr(token);
  const listRows = asList(body);
  for (const item of listRows) {
    if (pickToken(item) !== want) continue;
    const pct = pickPct(item);
    return pct != null ? pct : 0;
  }
  const d = body && body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
  if (d) {
    const direct = pickPct(d) ?? pickPct(d.holding) ?? pickPct(d.token);
    if (direct != null && (!pickToken(d) || pickToken(d) === want)) return direct;
  }
  return 0;
}

async function readPack(token, wallets, force) {
  const want = wallets.map((w) => normAddr(w.address)).filter(Boolean).slice(0, MAX_WALLETS);
  const noteOf = new Map(wallets.map((w) => [normAddr(w.address), w.note || ""]));
  const byWallet = new Map();
  let holdersOk = false;

  try {
    const res = await callPage("HOLDERS", { chain: token.gmgnChain, token: token.address, force }, 8000);
    if (res?.ok && res.body) {
      holdersOk = true;
      for (const row of extractHolderRows(res.body)) byWallet.set(row.address, row.pct);
    }
  } catch {
    holdersOk = false;
  }

  const missing = want.filter((w) => !byWallet.has(w));
  const fetched = [];
  for (let i = 0; i < missing.length; i += 3) {
    const chunk = missing.slice(i, i + 3);
    fetched.push(
      ...(await Promise.all(
        chunk.map(async (wallet) => {
          try {
            const res = await callPage(
              "WALLET",
              { chain: token.gmgnChain, wallet, token: token.address },
              8000
            );
            if (!res?.ok) return { wallet, pct: null, ok: false };
            const n = extractHoldingPct(res.body, token.address);
            return { wallet, pct: Number.isFinite(n) ? n : 0, ok: true };
          } catch {
            return { wallet, pct: null, ok: false };
          }
        })
      ))
    );
  }

  const rows = [];
  let okN = 0;
  let failN = 0;
  for (const w of want) {
    if (byWallet.has(w)) {
      rows.push({ address: w, note: noteOf.get(w) || "", pct: byWallet.get(w) });
      okN += 1;
      continue;
    }
    const hit = fetched.find((r) => r.wallet === w);
    if (hit?.ok) {
      rows.push({ address: w, note: noteOf.get(w) || "", pct: hit.pct });
      okN += 1;
    } else if (holdersOk) {
      rows.push({ address: w, note: noteOf.get(w) || "", pct: 0 });
      okN += 1;
      failN += 1;
    } else {
      failN += 1;
    }
  }

  if (okN === 0 && !holdersOk) throw new Error("gmgn");
  if (okN === 0 && failN === want.length) throw new Error("gmgn");

  const pct = rows.reduce((sum, r) => sum + (Number(r.pct) || 0), 0);
  const holding = rows.filter((r) => r.pct > 0).length;
  return {
    ok: true,
    pct,
    extra: `${holding}/${want.length} 有仓`,
    rows,
    lowerBound: failN > 0 && pct > 0,
  };
}

async function requestHold(token, force, reason) {
  if (document.hidden) return;
  const key = tokenKey(token);
  if (!key) return;

  if (!list.length) {
    lastText = "—";
    lastState = "dash";
    lastExtra = "名单是空的";
    lastPct = null;
    lastRows = [];
    lastPaintKey = key;
    const chip = document.getElementById(CHIP_ID) || placeChip();
    if (chip) applyChip(chip, "—", "dash", "名单是空的", null, []);
    return;
  }

  const isTimer = reason === "timer";
  const isManual = Boolean(force) || reason === "manual";
  if (!isManual && !isTimer && key === lastPaintKey && lastState !== "dash" && lastState !== "load" && document.getElementById(CHIP_ID)) {
    return;
  }
  if (!isManual && askKey === key && Date.now() - askAt < 1500) return;
  if (!isManual) {
    askKey = key;
    askAt = Date.now();
  }

  const gen = ++reqGen;
  try {
    const res = await readPack(token, list, isManual);
    if (gen !== reqGen) return;
    paint(res, token);
  } catch (err) {
    if (gen !== reqGen) return;
    paint({ ok: false, error: String(err && err.message ? err.message : err) }, token);
  }
}

function manualRefresh() {
  const token = parseToken();
  if (!token) return;
  const chip = document.getElementById(CHIP_ID) || placeChip();
  if (chip) setChipSpin(chip, true);
  requestHold(token, true, "manual");
}

function sync() {
  const token = parseToken();
  if (!token) {
    if (lastKey) teardown();
    return;
  }

  const key = tokenKey(token);
  const switched = key !== lastKey;
  if (switched) {
    lastKey = key;
    lastPaintKey = "";
    lastText = "";
    lastState = "";
    lastExtra = "";
    lastPct = null;
    lastRows = [];
    lastBound = false;
    requestHold(token, false, "enter");
  }

  const addrEl = document.getElementById("token-base-address");
  if (!addrEl) return;

  const domCa = (addrEl.getAttribute("data-addr") || "").trim();
  const domNorm = /^0x[a-fA-F0-9]{40}$/.test(domCa) ? domCa.toLowerCase() : domCa;
  if (domNorm && domNorm !== token.address) return;

  const chip = placeChip();
  if (!chip) return;
  if (lastText) restoreLast(chip);
  else applyChip(chip, "…", "load", "", null, []);
  if (!switched && !list.length) applyChip(chip, "—", "dash", "名单是空的", null, []);
}

function scheduleSync() {
  clearTimeout(retryTimer);
  if (!parseToken()) {
    if (lastKey) teardown();
    return;
  }
  retryLeft = 24;
  const step = () => {
    sync();
    if (parseToken() && !document.getElementById(CHIP_ID) && retryLeft > 0) {
      retryLeft -= 1;
      retryTimer = setTimeout(step, retryLeft > 16 ? 50 : 160);
    }
  };
  retryTimer = setTimeout(step, 0);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.channel !== CHANNEL || d.dir !== "from-page") return;
  if (d.type === "REPLY") {
    const waiter = pending.get(d.requestId);
    if (!waiter) return;
    pending.delete(d.requestId);
    waiter(d.payload);
  }
});

window.addEventListener("dirtover-nav", scheduleSync);
window.addEventListener("popstate", scheduleSync);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearRefresh();
    return;
  }
  const token = parseToken();
  if (!token) return;
  const chip = document.getElementById(CHIP_ID);
  if (chip && lastText) restoreLast(chip);
  if (!lastText || lastState === "dash") requestHold(token, false, "enter");
  armRefresh();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "DIRTOVER_LIST") return;
  list = Array.isArray(msg.list) ? msg.list : [];
  const token = parseToken();
  if (token) requestHold(token, true, "manual");
  else scheduleSync();
});

chrome.runtime
  .sendMessage({ type: "DIRTOVER_GET_LIST" })
  .then((res) => {
    if (res?.ok && Array.isArray(res.list)) list = res.list;
    scheduleSync();
  })
  .catch(() => scheduleSync());
