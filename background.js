const GMGN_URL_PATTERNS = ["https://gmgn.ai/*"];
const KENNEL = "kennel.html";
const LIST_KEY = "dirtoverList";
const LEGACY_KEY = "beastoverList";

async function readList() {
  const bag = await chrome.storage.local.get([LIST_KEY, LEGACY_KEY]);
  if (Array.isArray(bag[LIST_KEY])) return bag[LIST_KEY];
  if (Array.isArray(bag[LEGACY_KEY])) {
    await chrome.storage.local.set({ [LIST_KEY]: bag[LEGACY_KEY] });
    return bag[LEGACY_KEY];
  }
  return [];
}

async function openKennel() {
  const url = chrome.runtime.getURL(KENNEL);
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

function pushList(list) {
  chrome.tabs.query({ url: GMGN_URL_PATTERNS }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, { type: "DIRTOVER_LIST", list }).catch(() => {});
    }
  });
}

chrome.action.onClicked.addListener(() => {
  openKennel().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "DIRTOVER_GET_LIST") {
    readList()
      .then((list) => sendResponse({ ok: true, list }))
      .catch(() => sendResponse({ ok: true, list: [] }));
    return true;
  }

  if (msg.type === "DIRTOVER_SET_LIST") {
    const list = Array.isArray(msg.list) ? msg.list : [];
    chrome.storage.local.set({ [LIST_KEY]: list }).then(() => {
      pushList(list);
      sendResponse({ ok: true, list });
    });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[LIST_KEY]) return;
  const list = Array.isArray(changes[LIST_KEY].newValue) ? changes[LIST_KEY].newValue : [];
  pushList(list);
});
