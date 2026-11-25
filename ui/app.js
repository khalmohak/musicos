// musicos TV UI: plain JS, no build step. Navigation is focus-based so it works
// with a keyboard, a TV remote over HDMI-CEC, IR remotes and gamepads mapped to keys.
"use strict";

const $ = (s) => document.querySelector(s);
const api = {
  get: (p) => fetch(p).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
  post: (p, body) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" },
                                 body: JSON.stringify(body || {}) }).then((r) => r.json()),
};
const art = (file) => (file ? `/api/art?file=${encodeURIComponent(file)}` : "");
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- view stack ----
const stack = [];      // [{type, params, focus}]
let items = [];        // focusable elements in current view
let focus = 0;
let status = null;

async function push(type, params = {}) {
  if (stack.length) stack[stack.length - 1].focus = focus;
  stack.push({ type, params, focus: 0 });
  await render();
}
async function pop() {
  if (stack.length <= 1) return;
  stack.pop();
  await render();
}

async function render() {
  const v = stack[stack.length - 1];
  const view = $("#view");
  try {
    view.innerHTML = await VIEWS[v.type](v.params);
  } catch (e) {
    view.innerHTML = `<div class="empty">Can't reach the player (${esc(e)}). Retrying…</div>`;
    setTimeout(render, 3000);
  }
  $("#crumbs").innerHTML = stack.map((s, i) => (i === stack.length - 1 ? esc(s.params.title || "Library")
    : `<span>${esc(s.params.title || "Library")} › </span>`)).join("");
  items = [...view.querySelectorAll("[data-nav]")];
  setFocus(Math.min(v.focus, items.length - 1));
  // lazy-load covers after first paint
  view.querySelectorAll("[data-art]").forEach((el) => {
    const img = new Image();
    img.onload = () => { el.style.backgroundImage = `url("${img.src}")`; el.textContent = ""; };
    img.src = el.dataset.art;
  });
  markPlaying();
}

const VIEWS = {
  async artists() {
    const artists = await api.get("/api/artists");
    if (!artists.length) return `<div class="empty">Library is empty. Mount music at /srv/music and run a library update (U).</div>`;
    return `<div class="grid">${artists.map((a) => `
      <div class="tile" data-nav data-artist="${esc(a)}">
        <div class="art">${esc(a.replace(/^the /i, "").charAt(0).toUpperCase())}</div>
        <div class="label"><div class="name">${esc(a)}</div></div>
      </div>`).join("")}</div>`;
  },
  async albums({ artist }) {
    const albums = await api.get(`/api/albums?artist=${encodeURIComponent(artist)}`);
    return `<div class="grid">${albums.map((a) => `
      <div class="tile" data-nav data-album="${esc(a.album)}" data-file="${esc(a.file)}">
        <div class="art" data-art="${art(a.file)}">♪</div>
        <div class="label"><div class="name">${esc(a.album || "Unknown album")}</div>
          <div class="sub">${esc(a.year)}${a.year ? " · " : ""}${a.tracks} tracks</div></div>
      </div>`).join("")}</div>`;
  },
  async tracks({ artist, album, file }) {
    const tracks = await api.get(`/api/tracks?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`);
    return `<div class="album-head"><div class="art" data-art="${art(file)}"></div>
        <div><h1>${esc(album)}</h1><p>${esc(artist)} · ${tracks.length} tracks</p></div></div>
      <div class="list">${tracks.map((t, i) => `
        <div class="row" data-nav data-pos="${i}" data-file="${esc(t.file)}">
          <span class="num">${esc(t.track.split("/")[0] || i + 1)}</span>
          <span class="title">${esc(t.title)}</span><span class="dur">${fmt(t.duration)}</span>
        </div>`).join("")}</div>`;
  },
};

// ---- focus & navigation ----
function setFocus(i) {
  if (!items.length) return;
  focus = Math.max(0, Math.min(items.length - 1, i));
  items.forEach((el, j) => el.classList.toggle("focused", j === focus));
  items[focus].scrollIntoView({ block: "nearest" });
}
function columns() {
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  const n = items.findIndex((el) => el.offsetTop !== top);
  return n === -1 ? items.length : n;
}
async function activate() {
  const el = items[focus];
  const v = stack[stack.length - 1];
  if (!el) return;
  if (v.type === "artists") return push("albums", { artist: el.dataset.artist, title: el.dataset.artist });
  if (v.type === "albums") return push("tracks", { artist: v.params.artist, album: el.dataset.album,
                                                   file: el.dataset.file, title: el.dataset.album });
  if (v.type === "tracks") {
    status = await api.post("/api/play", { artist: v.params.artist, album: v.params.album, pos: Number(el.dataset.pos) });
    updateNowPlaying();
  }
}

document.addEventListener("keydown", async (e) => {
  const cols = columns();
  const k = e.key;
  if (k === "ArrowRight") setFocus(focus + 1);
  else if (k === "ArrowLeft") setFocus(focus - 1);
  else if (k === "ArrowDown") setFocus(focus + cols);
  else if (k === "ArrowUp") setFocus(focus - cols);
  else if (k === "PageDown") setFocus(focus + cols * 4);
  else if (k === "PageUp") setFocus(focus - cols * 4);
  else if (k === "Home") setFocus(0);
  else if (k === "End") setFocus(items.length - 1);
  else if (k === "Enter" || k === "OK") await activate();
  else if (k === "Backspace" || k === "Escape" || k === "BrowserBack" || k === "GoBack") await pop();
  else if (k === " " || k === "MediaPlayPause") status = await api.post("/api/control", { action: "toggle" });
  else if (k === "n" || k === "MediaTrackNext") status = await api.post("/api/control", { action: "next" });
  else if (k === "p" || k === "MediaTrackPrevious") status = await api.post("/api/control", { action: "previous" });
  else if (k === "s" || k === "MediaStop") status = await api.post("/api/control", { action: "stop" });
  else if (k === "+" || k === "=" || k === "AudioVolumeUp") status = await api.post("/api/volume", { volume: (status?.volume ?? 50) + 5 });
  else if (k === "-" || k === "AudioVolumeDown") status = await api.post("/api/volume", { volume: (status?.volume ?? 50) - 5 });
  else if (k === "u") { await api.post("/api/update"); setTimeout(render, 2000); }
  else return;
  e.preventDefault();
  updateNowPlaying();
});

// ---- now playing ----
let lastArt = "";
function updateNowPlaying() {
  const s = status;
  if (!s) return;
  const song = s.song;
  $("#np-title").textContent = song ? song.title || song.file : "Nothing playing";
  $("#np-sub").textContent = song ? [song.artist, song.album].filter(Boolean).join(" · ") : "";
  $("#np-fill").style.width = s.duration ? `${(100 * s.elapsed) / s.duration}%` : "0";
  const icon = { play: "▶", pause: "❚❚", stop: "■" }[s.state] || "";
  $("#np-state").textContent = song ? `${icon}  ${fmt(s.elapsed)} / ${fmt(s.duration)}${s.volume >= 0 ? `  ·  ${s.volume}%` : ""}` : "";
  const a = song ? art(song.file) : "";
  if (a !== lastArt) { lastArt = a; $("#np-art").style.backgroundImage = a ? `url("${a}")` : ""; }
  markPlaying();
}
function markPlaying() {
  const file = status?.song?.file;
  document.querySelectorAll(".row").forEach((r) => r.classList.toggle("playing", !!file && r.dataset.file === file));
}
async function poll() {
  try { status = await api.get("/api/status"); updateNowPlaying(); } catch (_) { /* agent restarting */ }
}
setInterval(poll, 1000);
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 1000);

push("artists", { title: "Library" });
poll();
