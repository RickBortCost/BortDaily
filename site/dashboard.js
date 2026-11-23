// Dashboard a widget: caricamento indipendente per widget, personalizzazione (aggiungi, rimuovi,
// riordina con trascinamento o frecce, dimensione S/M/L) e salvataggio del layout sul server.
import { $, $$, esc, icon, api, toast, ago, timeHM } from "./util.js";
import { TYPES, renderData, renderState, skeleton, badgeFor } from "./widgets.js";

const state = { layout: { widgets: [] }, results: new Map(), editing: false, inflight: new Map() };
const SINGLE = new Set(["weather", "calendar", "tasks", "gmail", "telegram"]); // le notizie possono comparire più volte

export function initDashboard() {
  $("#edit-btn").addEventListener("click", () => setEditing(!state.editing));
  $("#done-btn").addEventListener("click", () => setEditing(false));
  $("#add-btn").addEventListener("click", addWidget);
  const dash = $("#dash");
  dash.addEventListener("click", onClick);
  dash.addEventListener("pointerdown", onPointerDown);
}

// reset: dopo un cambio di impostazioni o di account i dati già caricati non valgono più
export function setLayout(layout, { reset = false } = {}) {
  if (reset) state.results.clear();
  state.layout = structuredClone(layout);
  renderAll();
}

function widgetEl(w) {
  const t = TYPES[w.type];
  return `<section class="w size-${w.size}" data-id="${esc(w.id)}" aria-labelledby="wt-${esc(w.id)}">
    <header class="w-head">${icon(t.icon)}<h2 id="wt-${esc(w.id)}">${esc(t.title)}</h2><span class="hb"></span>
      <button class="w-refresh" data-refresh aria-label="Aggiorna ${esc(t.title)}">${icon("refresh")}</button></header>
    <div class="w-body" aria-busy="true">${skeleton()}</div>
    <div class="w-foot" aria-live="polite"></div>
    <div class="w-edit" role="group" aria-label="Modifica ${esc(t.title)}">
      <button class="grip" data-grip aria-label="Trascina per spostare ${esc(t.title)}">${icon("grip")}</button>
      <button data-move="-1" aria-label="Sposta prima">${icon("up")}</button>
      <button data-move="1" aria-label="Sposta dopo">${icon("down")}</button>
      <span class="sizes" role="group" aria-label="Dimensione">${["S", "M", "L"].map((s) => `<button data-size="${s}" aria-pressed="${s === w.size}" aria-label="Dimensione ${s}">${s}</button>`).join("")}</span>
      <button class="rm" data-remove aria-label="Rimuovi ${esc(t.title)}">${icon("x")}</button>
    </div>
  </section>`;
}

function renderAll() {
  const dash = $("#dash");
  dash.innerHTML = state.layout.widgets.map(widgetEl).join("");
  $("#dash-empty").hidden = state.layout.widgets.length > 0;
  for (const w of state.layout.widgets) {
    const res = state.results.get(key(w));
    if (res) paint(w, res); else load(w);
  }
  renderAddMenu();
}

const key = (w) => `${w.type}:${w.size}:${w.cat ?? ""}`;
const elOf = (id) => $(`.w[data-id="${CSS.escape(id)}"]`);

function paint(w, res) {
  const el = elOf(w.id);
  if (!el) return;
  const body = $(".w-body", el);
  body.setAttribute("aria-busy", "false");
  let html;
  try { html = res.status === "ok" || res.data ? renderData(w, res) : renderState(res); }
  catch { html = renderState({ status: "error", error: { message: "Dati non leggibili." } }); }
  if (res.status !== "ok" && res.data) html = renderState(res) + html; // dati precedenti con avviso
  body.innerHTML = html;
  $(".hb", el).innerHTML = badgeFor(w.type, res.data);
  const foot = $(".w-foot", el);
  foot.classList.toggle("stale", !!res.stale);
  foot.textContent = res.updated ? `${res.stale ? "Dati non aggiornati · " : "Aggiornato "}${res.stale ? ago(res.updated) : timeHM(res.updated)}` : "";
}

// Ogni widget si carica da solo: un errore resta nel widget e non blocca gli altri
async function load(w, force = false) {
  const k = key(w);
  const el = elOf(w.id);
  if (el) { $(".w-refresh", el).classList.add("spin"); $(".w-body", el).setAttribute("aria-busy", "true"); }
  if (state.inflight.has(k) && !force) return state.inflight.get(k);
  const q = new URLSearchParams({ size: w.size });
  if (w.cat) q.set("cat", w.cat);
  if (force) q.set("refresh", "1");
  const p = api(`widget/${w.type}?${q}`)
    .catch((e) => {
      const prev = state.results.get(k);
      return { type: w.type, status: "error", data: prev?.data ?? null, stale: !!prev, updated: prev?.updated ?? null, error: { message: e.message } };
    })
    .then((res) => {
      state.results.set(k, res);
      for (const x of state.layout.widgets) if (key(x) === k) paint(x, res);
      return res;
    })
    .finally(() => {
      state.inflight.delete(k);
      for (const x of state.layout.widgets) if (key(x) === k) elOf(x.id)?.querySelector(".w-refresh")?.classList.remove("spin");
    });
  state.inflight.set(k, p);
  return p;
}

export function refreshAll(force = false) {
  return Promise.all(state.layout.widgets.map((w) => load(w, force)));
}

// ---------- personalizzazione
function setEditing(on) {
  state.editing = on;
  document.body.classList.toggle("editing", on);
  $("#edit-btn").setAttribute("aria-pressed", String(on));
  $("#edit-bar").hidden = !on;
  if (on) $("#edit-bar").scrollIntoView({ block: "nearest" });
}

function renderAddMenu() {
  const used = new Set(state.layout.widgets.map((w) => w.type));
  const opts = Object.entries(TYPES).filter(([t]) => !(SINGLE.has(t) && used.has(t)));
  $("#add-type").innerHTML = opts.map(([t, v]) => `<option value="${t}">${esc(v.title)}</option>`).join("");
  $("#add-btn").disabled = !opts.length || state.layout.widgets.length >= 12;
}

async function save() {
  try { await api("layout", { method: "PUT", body: state.layout }); }
  catch (e) { toast(`Layout non salvato: ${e.message}`); }
}

function addWidget() {
  const type = $("#add-type").value;
  if (!type) return;
  let id = type, n = 1;
  while (state.layout.widgets.some((w) => w.id === id)) id = `${type}-${++n}`;
  state.layout.widgets.push({ id: id.slice(0, 20), type, size: "M" });
  renderAll(); save();
  elOf(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  toast(`${TYPES[type].title} aggiunto`);
}

function onClick(e) {
  const el = e.target.closest(".w");
  if (!el) return;
  const i = state.layout.widgets.findIndex((w) => w.id === el.dataset.id);
  const w = state.layout.widgets[i];
  if (!w) return;
  const b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-refresh") || b.hasAttribute("data-retry")) { load(w, true); return; }
  if (b.dataset.cat) { w.cat = b.dataset.cat; save(); load(w); return; }
  if (b.dataset.size) { w.size = b.dataset.size; save(); renderAll(); elOf(w.id)?.querySelector(`[data-size="${w.size}"]`)?.focus(); return; }
  if (b.dataset.move) {
    const j = i + +b.dataset.move;
    if (j < 0 || j >= state.layout.widgets.length) return;
    state.layout.widgets.splice(j, 0, state.layout.widgets.splice(i, 1)[0]);
    save(); renderAll();
    elOf(w.id)?.querySelector(`[data-move="${b.dataset.move}"]`)?.focus();
    toast(`${TYPES[w.type].title}: posizione ${j + 1} di ${state.layout.widgets.length}`);
    return;
  }
  if (b.hasAttribute("data-remove")) {
    state.layout.widgets.splice(i, 1);
    save(); renderAll();
    toast(`${TYPES[w.type].title} rimosso`);
  }
}

// Trascinamento con Pointer Events (mouse, dito e penna; nessuna libreria)
function onPointerDown(e) {
  const grip = e.target.closest("[data-grip]");
  if (!grip || !state.editing) return;
  const card = grip.closest(".w");
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  card.classList.add("dragging");
  const start = { x: e.clientX, y: e.clientY };
  let target = null;
  const move = (ev) => {
    card.style.transform = `translate(${ev.clientX - start.x}px, ${ev.clientY - start.y}px) scale(1.02)`;
    const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList?.contains("w") && n !== card);
    if (under !== target) { target?.classList.remove("drop-target"); target = under ?? null; target?.classList.add("drop-target"); }
    if (ev.clientY < 80) scrollBy(0, -12); else if (ev.clientY > innerHeight - 80) scrollBy(0, 12); // scorrimento ai bordi
  };
  const up = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    grip.removeEventListener("pointercancel", up);
    card.classList.remove("dragging"); card.style.transform = "";
    if (target) {
      target.classList.remove("drop-target");
      const list = state.layout.widgets;
      const from = list.findIndex((w) => w.id === card.dataset.id), to = list.findIndex((w) => w.id === target.dataset.id);
      list.splice(to, 0, list.splice(from, 1)[0]);
      save(); renderAll();
      elOf(card.dataset.id)?.querySelector("[data-grip]")?.focus();
    }
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", up);
}
