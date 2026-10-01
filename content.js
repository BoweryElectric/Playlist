// Bridges the player page (a normal web page, no extension APIs) and this
// extension's background service worker.
//
// page -> content (window.postMessage, same window only), source "eko-playlist-page":
//   PING                         is the extension there?
//   REQUEST_SYNC                 read the bookmarks folder
//   STATE { state, requestId? }  player state; without requestId it is a push
//                                (also how a page registers as "the player")
// content -> page, source "eko-playlist-extension":
//   EXTENSION_PRESENT, SYNC_RESULT { ok, links?, error? }
//   GET_STATE { requestId }
//   COMMAND { cmd, value, requestId }   cmd: toggle | prev | next | volume | mute
//
// background -> content (chrome.tabs.sendMessage): EKO_GET_STATE, EKO_CMD.
// They are relayed to the page and answered with the page's STATE reply.

(function () {
  "use strict";

  var pending = {}; // requestId -> function(state)

  function toPage(msg) {
    msg.source = "eko-playlist-extension";
    window.postMessage(msg, "*");
  }

  // Let the page know the extension is installed and active.
  toPage({ type: "EXTENSION_PRESENT" });

  window.addEventListener("message", function (event) {
    if (event.source !== window) return; // ignore messages from iframes/other windows
    var data = event.data;
    if (!data || data.source !== "eko-playlist-page") return;

    // The page may PING us if it started listening after our one-shot
    // EXTENSION_PRESENT announcement already fired (race condition).
    if (data.type === "PING") {
      toPage({ type: "EXTENSION_PRESENT" });
      return;
    }

    if (data.type === "STATE") {
      if (data.requestId && pending[data.requestId]) {
        pending[data.requestId](data.state);
      } else if (!data.requestId) {
        try {
          chrome.runtime.sendMessage({ type: "EKO_STATE_PUSH", state: data.state }).catch(function () {});
        } catch (e) { /* extension was reloaded; the page needs a refresh */ }
      }
      return;
    }

    if (data.type !== "REQUEST_SYNC") return;

    chrome.runtime.sendMessage({ type: "EKO_PLAYLIST_GET_BOOKMARKS" }, function (response) {
      if (chrome.runtime.lastError) {
        toPage({ type: "SYNC_RESULT", ok: false, error: "extension-error" });
        return;
      }
      toPage({
        type: "SYNC_RESULT",
        ok: !!(response && response.ok),
        links: response && response.links ? response.links : [],
        error: response && response.error ? response.error : null
      });
    });
  });

  // Requests from the mini-player (via background).
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || (msg.type !== "EKO_GET_STATE" && msg.type !== "EKO_CMD")) return;

    var id = "r" + Date.now() + Math.random().toString(36).slice(2);
    var timer = setTimeout(function () {
      delete pending[id];
      sendResponse(null); // not the player page, or it is not answering
    }, 1500);
    pending[id] = function (state) {
      clearTimeout(timer);
      delete pending[id];
      sendResponse(state || null);
    };

    if (msg.type === "EKO_CMD") {
      toPage({ type: "COMMAND", cmd: msg.cmd, value: msg.value, requestId: id });
    } else {
      toPage({ type: "GET_STATE", requestId: id });
    }
    return true; // async response
  });
})();
