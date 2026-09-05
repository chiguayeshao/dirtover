const MAX = 60;
const NOTE_MAX = 80;
const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const $ = (id) => document.getElementById(id);

function norm(raw) {
  const s = String(raw || "").trim();
  if (EVM.test(s)) return s.toLowerCase();
  return s;
}

function valid(addr) {
  return EVM.test(addr) || SOL.test(addr);
}

function parseLine(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  const parts = t.split(/[\s,，]+/).filter(Boolean);
  const address = norm(parts[0] || "");
  const note = parts.slice(1).join(" ").trim();
  return { address, note };
}

function parseInput(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function parsePack(text) {
  let raw = String(text || "").trim();
  if (!raw) return { error: "先把 JSON 贴进来" };
  raw = raw.replace(/,\s*([}\]])/g, "$1");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "JSON 解析失败" };
  }
  if (data && !Array.isArray(data) && typeof data === "object" && (data.address || data.wallet)) {
    data = [data];
  }
  if (!Array.isArray(data)) return { error: "最外层必须是数组" };
  const rows = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const address = norm(item.address || item.wallet || "");
    const note = String(item.name ?? item.note ?? "").trim().slice(0, NOTE_MAX);
    if (!address) continue;
    if (!valid(address)) return { error: `地址不对：${address.slice(0, 18)}` };
    rows.push({ address, note });
  }
  if (!rows.length) return { error: "数组里没有有效地址" };
  return { rows };
}

function toPackJson(rows) {
  return JSON.stringify(
    rows.map((r) => ({ address: r.address, name: r.note || "" })),
    null,
    2
  );
}

function looksJson(text) {
  const t = String(text || "").trim();
  return t.startsWith("[") || t.startsWith("{");
}

function detect(text) {
  const raw = String(text || "").trim();
  if (!raw) return { kind: "empty" };
  if (looksJson(raw)) {
    const parsed = parsePack(raw);
    if (parsed.error) return { kind: "error", error: parsed.error };
    return { kind: "json", rows: parsed.rows };
  }
  const rows = parseInput(raw);
  if (!rows.length) return { kind: "empty" };
  const bad = rows.find((r) => !valid(r.address));
  if (bad) return { kind: "error", error: `地址不对：${bad.address.slice(0, 18)}` };
  return { kind: "addr", rows };
}

function toast(text, kind) {
  const el = $("toast");
  el.textContent = text || "";
  el.dataset.kind = kind || "";
  el.hidden = !text;
  clearTimeout(toast.timer);
  if (text && kind !== "err") {
    toast.timer = setTimeout(() => {
      el.textContent = "";
      el.hidden = true;
    }, 2400);
  }
}

function render(rows) {
  $("count").textContent = `${rows.length} / ${MAX}`;
  $("clear").hidden = rows.length === 0;
  $("export").hidden = rows.length === 0;
  $("export").disabled = rows.length === 0;
  $("empty").hidden = rows.length > 0;
  const ul = $("list");
  ul.replaceChildren();
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "row";
    const note = document.createElement("input");
    note.type = "text";
    note.className = "note";
    note.maxLength = NOTE_MAX;
    note.placeholder = "加个备注";
    note.value = row.note || "";
    note.dataset.note = row.address;
    note.setAttribute("aria-label", "备注");
    const addr = document.createElement("button");
    addr.type = "button";
    addr.className = "addr";
    addr.dataset.copy = row.address;
    addr.title = "点击复制";
    addr.append(document.createTextNode(row.address));
    const hint = document.createElement("span");
    hint.className = "copy-hint";
    hint.textContent = "复制";
    addr.append(hint);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(note, addr);
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.dataset.addr = row.address;
    drop.textContent = "移除";
    li.append(meta, drop);
    ul.appendChild(li);
  }
}

function paintDetect() {
  const preview = detect($("paste").value);
  const form = $("form");
  const line = $("detect");
  const commit = $("commit");
  const replace = $("replace");
  form.dataset.kind = preview.kind;
  if (preview.kind === "empty") {
    line.hidden = true;
    line.textContent = "";
    commit.disabled = true;
    commit.textContent = "加入名单";
    replace.hidden = true;
    return preview;
  }
  if (preview.kind === "error") {
    line.hidden = false;
    line.dataset.kind = "err";
    line.textContent = preview.error;
    commit.disabled = true;
    commit.textContent = "加入名单";
    replace.hidden = true;
    return preview;
  }
  const n = preview.rows.length;
  line.hidden = false;
  line.dataset.kind = "ok";
  commit.disabled = false;
  if (preview.kind === "json") {
    line.textContent = `识别到 JSON，${n} 个地址`;
    commit.textContent = n === 1 ? "并入这 1 个" : `并入这 ${n} 个`;
    replace.hidden = false;
  } else {
    line.textContent = n === 1 ? "1 个地址" : `${n} 个地址`;
    commit.textContent = n === 1 ? "加入这 1 个" : `加入这 ${n} 个`;
    replace.hidden = true;
  }
  return preview;
}

const memory = { list: [] };

function canTalk() {
  return typeof chrome !== "undefined" && Boolean(chrome?.runtime?.sendMessage);
}

async function load() {
  if (!canTalk()) return memory.list;
  const res = await chrome.runtime.sendMessage({ type: "DIRTOVER_GET_LIST" });
  return Array.isArray(res?.list) ? res.list : [];
}

async function save(next) {
  if (!canTalk()) {
    memory.list = next;
    return next;
  }
  const res = await chrome.runtime.sendMessage({ type: "DIRTOVER_SET_LIST", list: next });
  return Array.isArray(res?.list) ? res.list : next;
}

function mergeRows(incoming) {
  const next = list.slice();
  const index = new Map(next.map((r, i) => [r.address, i]));
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    const note = String(row.note || "").slice(0, NOTE_MAX);
    if (index.has(row.address)) {
      const i = index.get(row.address);
      if (note && next[i].note !== note) {
        next[i] = { ...next[i], note };
        updated += 1;
      }
      continue;
    }
    if (next.length >= MAX) break;
    index.set(row.address, next.length);
    next.push({ address: row.address, note });
    added += 1;
  }
  return { next, added, updated, capped: incoming.length > added + updated && next.length >= MAX };
}

function resultText(added, updated, capped) {
  const bits = [];
  if (added) bits.push(`加入 ${added}`);
  if (updated) bits.push(`更新 ${updated} 条备注`);
  if (capped) bits.push(`已满 ${MAX}`);
  return bits.join("，");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

async function copyOrSheet(text, okText) {
  const copied = await copyText(text);
  if (copied) {
    toast(okText, "ok");
    return;
  }
  $("copy-text").value = text;
  $("copy-fallback").showModal();
  $("copy-text").focus();
  $("copy-text").select();
}

let list = [];

async function applyIncoming(incoming, mode) {
  if (!incoming.length) return;
  if (mode === "replace") {
    const next = incoming.slice(0, MAX);
    list = await save(next);
    render(list);
    $("paste").value = "";
    paintDetect();
    toast(incoming.length > MAX ? `已换成 ${MAX} 个，多的丢掉了` : `已换成 ${next.length} 个`, "ok");
    return;
  }
  const { next, added, updated, capped } = mergeRows(incoming);
  if (!added && !updated) {
    toast("这些地址已经在名单里", "err");
    return;
  }
  list = await save(next);
  render(list);
  $("paste").value = "";
  paintDetect();
  toast(resultText(added, updated, capped), "ok");
}

async function boot() {
  list = await load();
  render(list);
  paintDetect();

  $("paste").addEventListener("input", paintDetect);
  $("paste").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      $("form").requestSubmit();
    }
  });

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const preview = detect($("paste").value);
    if (preview.kind === "empty") {
      toast("先贴至少一个地址", "err");
      $("paste").focus();
      return;
    }
    if (preview.kind === "error") {
      toast(preview.error, "err");
      $("paste").focus();
      return;
    }
    await applyIncoming(preview.rows, "merge");
  });

  $("replace").addEventListener("click", async () => {
    const preview = detect($("paste").value);
    if (preview.kind !== "json") return;
    if (list.length && !confirm(`用这 ${preview.rows.length} 个替换当前 ${list.length} 个？`)) return;
    await applyIncoming(preview.rows, "replace");
  });

  $("list").addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      await copyOrSheet(copy.getAttribute("data-copy"), "已复制地址");
      return;
    }
    const btn = event.target.closest("[data-addr]");
    if (!btn) return;
    const addr = btn.getAttribute("data-addr");
    list = await save(list.filter((r) => r.address !== addr));
    render(list);
    toast("已移除", "ok");
  });

  $("list").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-note]");
    if (!input) return;
    const addr = input.getAttribute("data-note");
    const note = input.value.trim().slice(0, NOTE_MAX);
    const next = list.map((r) => (r.address === addr ? { ...r, note } : r));
    list = await save(next);
    toast("备注已改", "ok");
  });

  $("clear").addEventListener("click", async () => {
    if (!list.length) return;
    if (!confirm(`清空全部 ${list.length} 个地址？`)) return;
    list = await save([]);
    render(list);
    toast("已清空", "ok");
  });

  $("export").addEventListener("click", async () => {
    await copyOrSheet(toPackJson(list), list.length ? `已复制 ${list.length} 条` : "名单是空的");
  });
}

boot().catch((err) => toast(String(err && err.message ? err.message : err), "err"));
