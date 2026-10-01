// Service worker (Manifest V3).
//  1) talks to chrome.bookmarks on behalf of the content script;
//  2) routes mini-player (popup) <-> player tab (content script).
//
// Player tabs register themselves by pushing their state (EKO_STATE_PUSH).
// The registry lives in chrome.storage.session because the worker can be
// killed at any moment.

const FOLDER_TITLE = "playlist";

// ---------- Bookmarks ----------
function findFolderByTitle(nodes, title) {
  for (const node of nodes) {
    if (!node.url && node.title && node.title.toLowerCase() === title.toLowerCase()) {
      return node;
    }
    if (node.children) {
      const found = findFolderByTitle(node.children, title);
      if (found) return found;
    }
  }
  return null;
}

function collectBookmarkLinks(nodes, out) {
  for (const node of nodes) {
    if (node.url) {
      out.push({ title: node.title || "", url: node.url });
    }
    if (node.children) {
      collectBookmarkLinks(node.children, out);
    }
  }
}

async function getPlaylistFolderLinks() {
  const tree = await chrome.bookmarks.getTree();
  const folder = findFolderByTitle(tree, FOLDER_TITLE);
  if (!folder) {
    return { ok: false, error: "folder-not-found" };
  }
  const links = [];
  collectBookmarkLinks(folder.children || [], links);
  return { ok: true, links: links };
}

// ---------- Player tab registry ----------
async function getRegistry() {
  const r = await chrome.storage.session.get("players");
  return r.players || {};
}

function setRegistry(players) {
  return chrome.storage.session.set({ players: players });
}

async function askTab(tabId, msg) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, msg);
    return res && typeof res === "object" ? res : null;
  } catch (e) {
    return null; // tab closed, discarded, or content script gone
  }
}

// Sends msg to the best player tab (playing first, then most recently seen).
// Returns that tab's state (with tabId/windowId) or null if no tab answers.
async function askPlayer(msg) {
  const reg = await getRegistry();
  const keys = Object.keys(reg).sort(function (a, b) {
    return (Number(reg[b].isPlaying) - Number(reg[a].isPlaying)) || (reg[b].seen - reg[a].seen);
  });
  let changed = false;
  for (const key of keys) {
    const tabId = Number(key);
    const state = await askTab(tabId, msg);
    if (state) {
      let windowId = reg[key].windowId;
      try { windowId = (await chrome.tabs.get(tabId)).windowId; } catch (e) {}
      if (changed) await setRegistry(reg);
      return Object.assign({}, state, { tabId: tabId, windowId: windowId });
    }
    delete reg[key];
    changed = true;
  }
  if (changed) await setRegistry(reg);
  return null;
}

async function handlePush(state, sender) {
  if (!state || !sender || !sender.tab) return;
  const tabId = sender.tab.id;
  const reg = await getRegistry();
  reg[tabId] = { windowId: sender.tab.windowId, isPlaying: !!state.isPlaying, seen: Date.now() };
  await setRegistry(reg);
  // Live update for an open popup. Rejects when no popup is listening — fine.
  chrome.runtime.sendMessage({
    type: "EKO_STATE",
    state: Object.assign({}, state, { tabId: tabId, windowId: sender.tab.windowId })
  }).catch(function () {});
}

chrome.tabs.onRemoved.addListener(async function (tabId) {
  const reg = await getRegistry();
  if (reg[tabId]) {
    delete reg[tabId];
    await setRegistry(reg);
  }
});

// ---------- Messages ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  switch (message.type) {
    case "EKO_PLAYLIST_GET_BOOKMARKS":
      getPlaylistFolderLinks()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
      return true; // keep the message channel open for the async response

    case "EKO_STATE_PUSH":
      handlePush(message.state, sender);
      return;

    case "EKO_GET_STATE":
      askPlayer({ type: "EKO_GET_STATE" }).then(sendResponse);
      return true;

    case "EKO_CMD":
      askPlayer({ type: "EKO_CMD", cmd: message.cmd, value: message.value }).then(sendResponse);
      return true;
  }
});
