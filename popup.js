(function () {
  "use strict";

  var PLAYER_URL = "https://boweryelectric.github.io/Playlist/";

  var ICON_PLAY = '<path d="M8 5V19L19 12L8 5Z"/>';
  var ICON_PAUSE = '<path d="M6 19H10V5H6V19M14 5V19H18V5H14Z"/>';
  var ICON_VOL_HIGH = '<path d="M3 9V15H7L12 20V4L7 9H3M16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.02C15.48 15.29 16.5 13.77 16.5 12M14 3.23V5.29C16.89 6.15 19 8.83 19 12S16.89 17.85 14 18.71V20.77C18.01 19.86 21 16.28 21 12S18.01 4.14 14 3.23Z"/>';
  var ICON_VOL_LOW = '<path d="M5 9V15H9L14 20V4L9 9M18.5 12C18.5 10.23 17.5 8.71 16 7.97V16C17.5 15.29 18.5 13.76 18.5 12Z"/>';
  var ICON_VOL_OFF = '<path d="M12 4L9.91 6.09L12 8.18M4.27 3L3 4.27L7.73 9H3V15H7L12 20V13.27L16.25 17.53C15.58 18.04 14.83 18.46 14 18.7V20.77C15.38 20.45 16.63 19.82 17.68 18.96L19.73 21L21 19.73L12 10.73M19 12C19 12.94 18.8 13.82 18.46 14.64L19.97 16.15C20.62 14.91 21 13.5 21 12C21 7.72 18.01 4.14 14 3.23V5.29C16.89 6.15 19 8.83 19 12M16.5 12C16.5 10.23 15.5 8.71 14 7.97V10.18L16.45 12.63C16.5 12.43 16.5 12.21 16.5 12Z"/>';

  var els = {
    card: document.getElementById("card"),
    thumb: document.getElementById("thumb"),
    title: document.getElementById("title"),
    sub: document.getElementById("sub"),
    prevBtn: document.getElementById("prevBtn"),
    playBtn: document.getElementById("playBtn"),
    playIcon: document.getElementById("playIcon"),
    nextBtn: document.getElementById("nextBtn"),
    openBtn: document.getElementById("openBtn"),
    muteBtn: document.getElementById("muteBtn"),
    volIcon: document.getElementById("volIcon"),
    volSlider: document.getElementById("volSlider")
  };

  var lastState = null;   // last state from the player tab (null = no player tab)
  var dragging = false;   // user is moving the slider: don't let pushes fight the thumb
  var volTimer = null;
  var volPending = 0;

  // ---------- Volume UI ----------
  function paintVolume(value, muted) {
    var shown = muted ? 0 : value;
    els.volSlider.style.setProperty("--fill", shown + "%");
    els.volIcon.innerHTML = shown === 0 ? ICON_VOL_OFF : (shown < 50 ? ICON_VOL_LOW : ICON_VOL_HIGH);
    els.muteBtn.title = shown === 0 ? "Включить звук" : "Без звука";
  }

  // ---------- Cover ----------
  function setThumb(url) {
    if (url) {
      if (els.thumb.getAttribute("src") !== url) els.thumb.src = url;
      els.thumb.hidden = false;
    } else {
      els.thumb.hidden = true;
      els.thumb.removeAttribute("src");
    }
  }
  els.thumb.addEventListener("error", function () { setThumb(""); });

  // ---------- Render ----------
  function render(state) {
    lastState = state;

    if (!state) {
      // No player tab answered.
      els.card.classList.add("closed");
      els.title.textContent = "Плеер не открыт";
      els.sub.textContent = "Открой вкладку с плеером, чтобы управлять им отсюда";
      setThumb("");
      els.openBtn.textContent = "Открыть плеер";
      els.openBtn.classList.add("primary");
      return;
    }

    els.card.classList.remove("closed");
    els.openBtn.textContent = "Перейти к плееру";
    els.openBtn.classList.remove("primary");

    if (state.hasTrack) {
      els.title.textContent = state.title || state.id;
      els.sub.textContent = "Трек " + (state.index + 1) + " из " + state.count;
      setThumb(state.thumb);
    } else {
      els.title.textContent = "Ничего не играет";
      els.sub.textContent = state.count > 0 ? "Нажми ▶, чтобы начать" : "Очередь пуста";
      setThumb("");
    }

    els.playIcon.innerHTML = state.isPlaying ? ICON_PAUSE : ICON_PLAY;
    var empty = state.count === 0;
    els.prevBtn.disabled = empty;
    els.playBtn.disabled = empty;
    els.nextBtn.disabled = empty;

    if (!dragging) {
      var vol = typeof state.volume === "number" ? state.volume : 100;
      els.volSlider.value = state.muted ? 0 : vol;
      paintVolume(vol, !!state.muted);
    }
  }

  // ---------- Talking to the player tab ----------
  function send(msg) {
    // Resolves with the player tab's reply, or null if nobody is listening.
    return chrome.runtime.sendMessage(msg).then(
      function (res) { return res && typeof res === "object" ? res : null; },
      function () { return null; }
    );
  }

  // The reply to a command can still carry the old play/pause state (YouTube
  // reports the change a moment later), so only "no player" is taken from it;
  // the real new state arrives as an EKO_STATE push.
  function command(cmd, value) {
    return send({ type: "EKO_CMD", cmd: cmd, value: value }).then(function (res) {
      if (!res) render(null);
    });
  }

  els.prevBtn.addEventListener("click", function () { command("prev"); });
  els.playBtn.addEventListener("click", function () { command("toggle"); });
  els.nextBtn.addEventListener("click", function () { command("next"); });
  els.muteBtn.addEventListener("click", function () { command("mute"); });

  // Slider: update locally right away, send to the player at most every 60 ms.
  els.volSlider.addEventListener("input", function () {
    dragging = true;
    var v = parseInt(els.volSlider.value, 10);
    paintVolume(v, false);
    volPending = v;
    if (volTimer) return;
    volTimer = setTimeout(function () {
      volTimer = null;
      command("volume", volPending);
    }, 60);
  });
  els.volSlider.addEventListener("change", function () {
    if (volTimer) { clearTimeout(volTimer); volTimer = null; }
    command("volume", parseInt(els.volSlider.value, 10)).then(function () { dragging = false; });
  });

  els.openBtn.addEventListener("click", function () {
    var done = function () { window.close(); };
    if (lastState && lastState.tabId != null) {
      chrome.tabs.update(lastState.tabId, { active: true }).catch(function () {});
      if (lastState.windowId != null) chrome.windows.update(lastState.windowId, { focused: true }).catch(function () {});
      done();
    } else {
      chrome.tabs.create({ url: PLAYER_URL }).then(done, done);
    }
  });

  // Live updates while the popup is open.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "EKO_STATE" || !msg.state) return;
    // A second player tab that isn't playing shouldn't steal the popup.
    if (lastState && msg.state.tabId !== lastState.tabId && !msg.state.isPlaying) return;
    render(msg.state);
  });

  send({ type: "EKO_GET_STATE" }).then(render);
})();
