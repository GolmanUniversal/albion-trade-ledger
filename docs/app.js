"use strict";
/* Albion Trade Ledger — static dashboard. Reads prices from the Albion Online Data Project (Americas)
   and item/recipe data built by build/build_data.py. No backend; settings and tracker live in localStorage. */

const VERSION = 2;
const API = "https://west.albion-online-data.com/api/v2/stats";
const ROYAL = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford"];
const CITIES = [...ROYAL, "Brecilien", "Caerleon"];
const BM = "Black Market";
const DANGER = new Set(["Caerleon", BM]); // reached through red zones (or the Travel Planner)
const URL_LIMIT = 3800;                   // API rejects URLs over 4096 characters
const REQ_GAP_MS = 700;                   // stay well under 180 requests/minute
const CACHE_MIN = 10;                     // re-use prices fetched in the last 10 minutes

// Return rates (resource return = 1 − 1/(1 + bonus)); source: albionfreemarket.com, inferred.
const RR = {
  refine: { bonus: [0.367, 0.539], base: [0.153, 0.435] }, // [no focus, focus]
  craft:  { bonus: [0.248, 0.479], base: [0.153, 0.435] },
};
const RETURNABLE = /_(METALBAR|LEATHER|CLOTH|PLANKS|STONEBLOCK)$/;
const SETUP_FEE = 0.025;
const OUTLIER = 2;       // listed price more than 2x the typical price is ignored
const STACK = 999;       // order depth is unknown, so batches are capped at one stack

// ---------- storage helpers ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("atl-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("atl-" + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const S = Object.assign({ premium: false, focus: false, capital: 500000, maxTier: 5, risk: "safe", maxAge: 12 },
  store.get("settings", {}));
const saveSettings = () => store.set("settings", S);
const tax = () => (S.premium ? 0.04 : 0.08);

// ---------- formatting ----------
const $ = (s) => document.querySelector(s);
const fmt = (n) => (n == null || !isFinite(n) ? "—" : (Math.round(n) || 0).toLocaleString("en-US"));
const pct = (n) => (n == null || !isFinite(n) ? "—" : (n * 100).toFixed(1) + "%");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ageText = (h) => (h == null ? "" : h < 1 ? Math.round(h * 60) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d");
let DATA = null;
const nameOf = (id) => (DATA && DATA.names[id]) || id;
const tierOf = (id) => +(id.match(/^T(\d)/) || [0, 0])[1];

function setStatus(msg, err) { const el = $("#status"); el.textContent = msg; el.classList.toggle("err", !!err); }

// ---------- prices ----------
// P[id][location] = { s: sellMin, st: hoursOld, b: buyMax, bt: hoursOld }, rebuilt from raw rows on load.
const RAW = store.get("prices", {}); // id -> { t: fetchedAtMs, rows: [[loc, s, sDate, b, bDate]] }
const P = {};
function hoursSince(d) { if (!d || d.startsWith("0001")) return null; return (Date.now() - Date.parse(d + "Z")) / 36e5; }
function index(id) {
  const e = RAW[id]; if (!e) return;
  P[id] = {};
  for (const [loc, s, sd, b, bd] of e.rows) P[id][loc] = { s: s || null, st: hoursSince(sd), b: b || null, bt: hoursSince(bd) };
}
Object.keys(RAW).forEach(index);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;
async function loadPrices(ids, label) {
  if (busy) return false;
  busy = true;
  document.querySelectorAll("button.primary").forEach((b) => (b.disabled = true));
  const now = Date.now();
  const need = [...new Set(ids)].filter((id) => !RAW[id] || now - RAW[id].t > CACHE_MIN * 60e3);
  const locs = encodeURIComponent([...CITIES, BM].join(","));
  const chunks = []; let cur = [];
  for (const id of need) {
    if ((cur.join(",").length + id.length + 120) > URL_LIMIT) { chunks.push(cur); cur = []; }
    cur.push(id);
  }
  if (cur.length) chunks.push(cur);
  let ok = true;
  try {
    for (let i = 0; i < chunks.length; i++) {
      setStatus(`Loading ${label} prices… ${i + 1}/${chunks.length}`);
      const url = `${API}/prices/${chunks[i].join(",")}.json?locations=${locs}&qualities=1`;
      let res = await fetch(url);
      if (res.status === 429) {
        setStatus("The price service is throttling requests. Waiting 60 seconds…", true);
        await sleep(60e3); res = await fetch(url);
      }
      if (!res.ok) throw new Error(`Price service answered ${res.status}`);
      const rows = await res.json();
      const by = {};
      for (const r of rows) (by[r.item_id] ||= []).push([r.city, r.sell_price_min, r.sell_price_min_date, r.buy_price_max, r.buy_price_max_date]);
      for (const id of chunks[i]) { RAW[id] = { t: Date.now(), rows: by[id] || [] }; index(id); }
      if (i < chunks.length - 1) await sleep(REQ_GAP_MS);
    }
    store.set("prices", RAW);
    setStatus(`Prices loaded ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  } catch (e) {
    ok = false;
    setStatus(`Couldn't load prices: ${e.message}. Check your connection and press Load again.`, true);
  } finally {
    busy = false;
    document.querySelectorAll("button.primary").forEach((b) => (b.disabled = false));
  }
  loadGold();
  return ok;
}
async function loadGold() {
  try {
    const r = await fetch(`${API}/gold?count=1`); const [g] = await r.json();
    if (g) $("#status").textContent += ` · 1 gold = ${fmt(g.price)} silver`;
  } catch { /* gold price is optional */ }
}

const fresh = (age) => age != null && age <= S.maxAge;
const allowedLoc = (loc) => S.risk !== "safe" || !DANGER.has(loc);
function sellMin(id, loc) { const p = P[id]?.[loc]; return p && p.s && fresh(p.st) ? { p: p.s, age: p.st, loc } : null; }
function buyMax(id, loc) { const p = P[id]?.[loc]; return p && p.b && fresh(p.bt) ? { p: p.b, age: p.bt, loc } : null; }
function cheapest(id, locs) {
  let best = null;
  for (const l of locs) { const q = sellMin(id, l); if (q && (!best || q.p < best.p)) best = q; }
  return best;
}
// Typical price: median of fresh lowest listings and highest buy orders across cities (needs 3+ points).
function typicalPrice(id) {
  const v = [];
  for (const l of CITIES) { const s = sellMin(id, l), b = buyMax(id, l); if (s) v.push(s.p); if (b) v.push(b.p); }
  if (v.length < 3) return null;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}
// Best net proceeds for selling one unit. quick = fill a buy order; list = post a sell order at the lowest price.
function bestSale(id, { quick = true, list = true, bm = false } = {}) {
  let best = null;
  const t = tax();
  const consider = (o) => { if (o && (!best || o.net > best.net)) best = o; };
  const locs = CITIES.filter(allowedLoc);
  if (bm && allowedLoc(BM)) locs.push(BM);
  const ref = typicalPrice(id);
  for (const l of locs) {
    if (quick) { const q = buyMax(id, l); if (q) consider({ net: q.p * (1 - t), loc: l, how: "quick", age: q.age }); }
    if (list && l !== BM) {
      const q = sellMin(id, l);
      // A lone listing far above every other city is usually one overpriced order, not a real market.
      if (q && !(ref && q.p > ref * OUTLIER)) consider({ net: q.p * (1 - t - SETUP_FEE), loc: l, how: "list", age: q.age });
    }
  }
  return best;
}
const riskChip = (...locs) => locs.some((l) => DANGER.has(l))
  ? `<span class="chip red" title="Reached through red zones, or by Travel Planner">red zone</span>`
  : `<span class="chip safe">safe</span>`;
const ageChip = (h) => (h == null ? "" : `<span class="chip ${h > 3 ? "old" : "safe"}" title="Age of the oldest price used">${ageText(h)}</span>`);

// Travel Planner estimate per unit, distance 2 (worst case). Source: albionfreemarket.com, single source.
function teleportPerUnit(id, kg) {
  if (!kg) return null;
  const isRes = RETURNABLE.test(id) || /^T\d_(ORE|HIDE|FIBER|WOOD|ROCK)$/.test(id);
  const factor = isRes ? Math.min(2 ** (tierOf(id) - 3), 256) : 1;
  return 150 * kg * factor * 2;
}

// ---------- table renderer ----------
function renderTable(el, cols, rows, opts = {}) {
  const key = el.dataset.sort || opts.sort;
  const dir = +(el.dataset.dir || -1);
  const col = cols.find((c) => c.key === key);
  if (col) rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
  const shown = rows.slice(0, opts.limit || 200);
  el.innerHTML = `<thead><tr>${cols.map((c) =>
    `<th data-k="${c.key}" class="${c.num ? "num" : ""} ${c.key === key ? "sorted" : ""}">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${shown.length ? shown.map((r, i) => `<tr data-i="${i}" class="${opts.onRow ? "click" : ""}">${cols.map((c) =>
      `<td class="${c.num ? "num" : ""} ${c.cls ? c.cls(r) : ""}">${c.html ? c.html(r) : c.num ? fmt(r[c.key]) : esc(r[c.key] ?? "—")}</td>`).join("")}</tr>`).join("")
      : `<tr><td class="empty" colspan="${cols.length}">${opts.empty || "No rows."}</td></tr>`}</tbody>`;
  el.querySelectorAll("th").forEach((th) => th.onclick = () => {
    if (el.dataset.sort === th.dataset.k) el.dataset.dir = String(-dir); else { el.dataset.sort = th.dataset.k; el.dataset.dir = "-1"; }
    opts.rerender();
  });
  if (opts.onRow) el.querySelectorAll("tbody tr[data-i]").forEach((tr) => tr.onclick = () => opts.onRow(shown[+tr.dataset.i]));
  if (rows.length > shown.length) el.querySelector("tbody").insertAdjacentHTML("beforeend",
    `<tr><td class="empty" colspan="${cols.length}">Showing the top ${shown.length} of ${rows.length}. Sort by another column or narrow the filters.</td></tr>`);
}
const itemCell = (r) => `<span class="tier">${esc(r.tierLabel || "T" + tierOf(r.id))}</span>${esc(nameOf(r.id))}`;
const signCls = (k) => (r) => (r[k] > 0 ? "pos" : r[k] < 0 ? "neg" : "");
const NOT_LOADED = "Press <b>Load prices</b> to fetch live market data.";

// ---------- refining ----------
function materialCost(rec, rr, locs) {
  let cost = 0, oldest = 0, src = new Set();
  for (const [id, n] of rec.in) {
    const q = cheapest(id, locs); if (!q) return null;
    const keep = RETURNABLE.test(id) || /^T\d_(ORE|HIDE|FIBER|WOOD|ROCK)$/.test(id) ? 1 - rr : 1;
    cost += q.p * n * keep; oldest = Math.max(oldest, q.age); src.add(q.loc);
  }
  return { cost: cost / (rec.out || 1), oldest, src: [...src] };
}
function refineRows() {
  const type = $("#ref-type").value, buyMode = $("#ref-buy").value;
  const rows = [];
  for (const r of DATA.refine) {
    if (r.tier > S.maxTier || (type && r.type !== type)) continue;
    const locs = buyMode === "refcity" ? [r.city] : CITIES.filter(allowedLoc);
    const rr = RR.refine.bonus;
    const c0 = materialCost(r, rr[0], locs), c1 = materialCost(r, rr[1], locs);
    const sale = bestSale(r.id);
    const cost = S.focus ? c1?.cost : c0?.cost;
    const profit = sale && cost != null ? sale.net - cost : null;
    const gain = c0 && c1 && r.focus ? ((c0.cost - c1.cost) / r.focus) * 100 : null;
    rows.push({ id: r.id, type: r.type, city: r.city, buyAt: c0 ? c0.src.join(", ") : "—", cost, sale: sale?.net,
      sellAt: sale ? `${sale.loc} (${sale.how})` : "—", profit, margin: profit != null && cost ? profit / cost : null,
      focusGain: gain, age: Math.max(c0?.oldest || 0, sale?.age || 0) || null, kg: r.kg });
  }
  return rows;
}
function renderRefine() {
  const rows = refineRows();
  renderTable($("#ref-table"), [
    { key: "id", label: "Item", html: itemCell },
    { key: "city", label: "Refine in" },
    { key: "buyAt", label: "Buy inputs in" },
    { key: "cost", label: "Material cost", num: true },
    { key: "sellAt", label: "Sell in" },
    { key: "sale", label: "You receive", num: true },
    { key: "profit", label: "Profit / unit", num: true, cls: signCls("profit") },
    { key: "margin", label: "Margin", num: true, html: (r) => pct(r.margin), cls: signCls("margin") },
    { key: "focusGain", label: "Focus value / 100", num: true },
    { key: "age", label: "Data age", html: (r) => ageChip(r.age) },
  ], rows, { sort: "profit", empty: NOT_LOADED, rerender: renderRefine, onRow: (r) => showHistory(r.id, [r.city]) });
}

// ---------- crafting ----------
function craftRows() {
  const tier = +$("#cr-tier").value, cat = $("#cr-cat").value, noArt = $("#cr-noart").checked;
  const rows = [];
  for (const c of DATA.craft) {
    if (c.tier !== tier || (cat && c.cat !== cat)) continue;
    if (noArt && c.in.some(([id]) => /ARTEFACT/.test(id))) continue;
    const locs = c.city ? [c.city] : CITIES.filter(allowedLoc);
    const rr = (c.city ? RR.craft.bonus : RR.craft.base)[S.focus ? 1 : 0];
    const m = materialCost(c, rr, locs);
    const sale = bestSale(c.id, { bm: true });
    const profit = m && sale ? sale.net - m.cost : null;
    rows.push({ id: c.id, cat: c.cat, city: c.city || "any (no bonus)", cost: m?.cost, sale: sale?.net,
      sellAt: sale ? `${sale.loc} (${sale.how})` : "—", sellLoc: sale?.loc, profit,
      margin: profit != null && m?.cost ? profit / m.cost : null, age: Math.max(m?.oldest || 0, sale?.age || 0) || null });
  }
  return rows;
}
function renderCraft() {
  renderTable($("#cr-table"), [
    { key: "id", label: "Item", html: itemCell },
    { key: "cat", label: "Type" },
    { key: "city", label: "Craft in" },
    { key: "cost", label: "Material cost", num: true },
    { key: "sellAt", label: "Sell in", html: (r) => `${esc(r.sellAt)} ${r.sellLoc ? riskChip(r.sellLoc) : ""}` },
    { key: "sale", label: "You receive", num: true },
    { key: "profit", label: "Profit", num: true, cls: signCls("profit") },
    { key: "margin", label: "Margin", num: true, html: (r) => pct(r.margin), cls: signCls("margin") },
    { key: "age", label: "Data age", html: (r) => ageChip(r.age) },
  ], craftRows(), { sort: "profit", empty: NOT_LOADED, rerender: renderCraft,
    onRow: (r) => showHistory(r.id, [r.sellLoc, r.city].filter((l) => l && CITIES.includes(l) || l === BM)) });
}
function craftIds() {
  const tier = +$("#cr-tier").value, cat = $("#cr-cat").value;
  const ids = [];
  for (const c of DATA.craft) if (c.tier === tier && (!cat || c.cat === cat)) { ids.push(c.id); c.in.forEach(([i]) => ids.push(i)); }
  return ids;
}

// ---------- flipping ----------
const KG = {};
function flipIds() {
  const set = $("#fl-set").value;
  if (set === "refined") return DATA.refine.filter((r) => r.tier <= S.maxTier + 1).map((r) => r.id);
  if (set === "raw") return DATA.raw.filter((r) => r.tier <= S.maxTier + 1).map((r) => r.id);
  return DATA.craft.filter((c) => c.tier <= S.maxTier && c.tier >= Math.max(3, S.maxTier - 1)).map((c) => c.id);
}
function renderFlip() {
  const quick = $("#fl-mode").value === "quick", t = tax();
  const gear = $("#fl-set").value === "gear";
  const rows = [];
  const budget = S.capital * 0.25;
  for (const id of flipIds()) {
    let best = null;
    for (const a of CITIES.filter(allowedLoc)) {
      const buy = sellMin(id, a); if (!buy) continue;
      const sellLocs = CITIES.filter((l) => l !== a && allowedLoc(l));
      if (gear && quick && allowedLoc(BM)) sellLocs.push(BM);
      for (const b of sellLocs) {
        const q = quick ? buyMax(id, b) : b === BM ? null : sellMin(id, b);
        if (!q) continue;
        const ref = typicalPrice(id);
        if (!quick && ref && q.p > ref * OUTLIER) continue;
        const net = q.p * (1 - t - (quick ? 0 : SETUP_FEE));
        const profit = net - buy.p;
        if (!best || profit > best.profit) best = { a, b, buy: buy.p, net, profit, age: Math.max(buy.age, q.age) };
      }
    }
    if (!best || best.profit <= 0) continue;
    const units = Math.min(STACK, Math.floor(budget / best.buy));
    const tp = teleportPerUnit(id, KG[id]);
    rows.push({ id, route: `${best.a} → ${best.b}`, a: best.a, b: best.b, buy: best.buy, net: best.net, profit: best.profit,
      roi: best.profit / best.buy, units, total: best.profit * units, tp, tpProfit: tp != null ? best.profit - tp : null, age: best.age });
  }
  renderTable($("#fl-table"), [
    { key: "id", label: "Item", html: itemCell },
    { key: "route", label: "Route", html: (r) => `${esc(r.route)} ${riskChip(r.a, r.b)}` },
    { key: "buy", label: "Buy at", num: true },
    { key: "net", label: "You receive", num: true },
    { key: "profit", label: "Profit / unit", num: true, cls: signCls("profit") },
    { key: "roi", label: "Return", num: true, html: (r) => pct(r.roi) },
    { key: "units", label: "Units", num: true },
    { key: "total", label: "Profit for the batch", num: true, cls: signCls("total") },
    { key: "tpProfit", label: "After Travel Planner (est.)", num: true, cls: signCls("tpProfit") },
    { key: "age", label: "Data age", html: (r) => ageChip(r.age) },
  ], rows, { sort: "total", rerender: renderFlip,
    empty: Object.keys(P).length ? "No profitable routes at these settings with fresh prices. Try a longer price age or another item set." : NOT_LOADED,
    onRow: (r) => showHistory(r.id, [r.a, r.b]) });
}

// ---------- gathering ----------
function renderGather() {
  const maxT = +$("#ga-tier").value;
  const rows = DATA.raw.filter((r) => r.tier <= maxT).map((r) => {
    const sale = bestSale(r.id);
    return { id: r.id, type: r.type, best: sale?.net, where: sale ? `${sale.loc} (${sale.how})` : "—",
      perKg: sale && r.kg ? sale.net / r.kg : null, kg: r.kg, age: sale?.age };
  });
  renderTable($("#ga-table"), [
    { key: "id", label: "Resource", html: itemCell },
    { key: "type", label: "Type" },
    { key: "best", label: "Best price", num: true },
    { key: "where", label: "Sell in" },
    { key: "kg", label: "Weight (kg)", num: true, html: (r) => (r.kg ? r.kg.toFixed(2) : "—") },
    { key: "perKg", label: "Silver per kg", num: true },
    { key: "age", label: "Data age", html: (r) => ageChip(r.age) },
  ], rows, { sort: "perKg", empty: NOT_LOADED, rerender: renderGather, onRow: (r) => showHistory(r.id, ROYAL) });
}

// ---------- history dialog ----------
async function showHistory(id, locs) {
  const dlg = $("#hist");
  locs = [...new Set(locs.filter(Boolean))];
  if (!locs.length) locs = ROYAL;
  $("#hist-title").textContent = nameOf(id) + " · daily sales";
  $("#hist-body").innerHTML = `<p class="hint">Loading 30-day history…</p>`;
  dlg.showModal();
  try {
    const r = await fetch(`${API}/history/${id}.json?locations=${encodeURIComponent(locs.join(","))}&time-scale=24&qualities=1`);
    if (!r.ok) throw new Error("the price service answered " + r.status);
    const series = await r.json();
    if (!series.length) { $("#hist-body").innerHTML = `<p class="hint">No sales recorded for this item in ${esc(locs.join(", "))}.</p>`; return; }
    $("#hist-body").innerHTML = series.map((s) => {
      const d = s.data.slice(-30), last7 = d.slice(-7);
      const vol = last7.reduce((a, x) => a + x.item_count, 0) / Math.max(1, last7.length);
      const avg = last7.reduce((a, x) => a + x.avg_price, 0) / Math.max(1, last7.length);
      return `<div class="guide-sec"><h3>${esc(s.location)}</h3>
        <p><b>${fmt(vol)}</b> sold per day · average price <b>${fmt(avg)}</b> (last 7 days)</p>
        <div class="chart">${spark(d.map((x) => x.avg_price), d.map((x) => x.item_count))}</div></div>`;
    }).join("") + `<p class="hint">Few sales per day means you may wait a long time to sell. Prefer items that sell at least as many per day as you plan to make.</p>`;
  } catch (e) {
    $("#hist-body").innerHTML = `<p class="hint">Couldn't load history: ${esc(e.message)}.</p>`;
  }
}
function spark(prices, vols) {
  const W = 640, H = 120, pad = 28;
  if (prices.length < 2) return "";
  const max = Math.max(...prices), min = Math.min(...prices), vmax = Math.max(...vols, 1);
  const x = (i) => pad + (i * (W - pad * 2)) / (prices.length - 1);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const bars = vols.map((v, i) => `<rect x="${x(i) - 3}" y="${H - pad - (v / vmax) * 30}" width="6" height="${(v / vmax) * 30}" fill="var(--line)"/>`).join("");
  const line = prices.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price and sales over 30 days">${bars}
    <path d="${line}" fill="none" stroke="var(--gold)" stroke-width="2"/>
    <circle cx="${x(prices.length - 1)}" cy="${y(prices.at(-1))}" r="4" fill="var(--gold)"/>
    <text x="4" y="${y(max) + 4}">${fmt(max)}</text><text x="4" y="${y(min) + 4}">${fmt(min)}</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end">bars = units sold</text></svg>`;
}

// ---------- risk ----------
function renderRisk() {
  const cargo = +$("#rk-cargo").value || 0, gear = +$("#rk-gear").value || 0, profit = +$("#rk-profit").value || 0;
  const p = +$("#rk-p").value / 100;
  $("#rk-p-out").textContent = Math.round(p * 100) + "%";
  const loss = cargo + gear;
  const ev = (1 - p) * profit - p * loss;
  const breakeven = profit + loss ? profit / (profit + loss) : 0;
  const share = S.capital ? loss / S.capital : null;
  const good = ev > 0 && (share == null || share <= 0.25);
  $("#rk-result").innerHTML = `
    <p class="big ${good ? "pos" : "neg"}">${good ? "Worth running" : ev > 0 ? "Profitable, but too much at stake" : "Not worth it"}</p>
    <p>Expected result per run: <b class="${ev >= 0 ? "pos" : "neg"}">${ev >= 0 ? "+" : ""}${fmt(ev)}</b> silver.</p>
    <p>The run breaks even if you get caught less than <b>${pct(breakeven)}</b> of the time.</p>
    ${share != null ? `<p>A death costs <b>${pct(share)}</b> of your silver.${share > 0.25 ? " Keep it under 25% (see the table)." : ""}</p>` : ""}`;
  $("#rk-cap").textContent = fmt(S.capital);
  const lim = [["Royal city to royal city (safe zones)", 0.5], ["Short red-zone run, or Travel Planner", 0.2],
    ["Into Caerleon on foot", 0.1], ["Black zones or Roads of Avalon", 0.05]];
  $("#rk-carry").innerHTML = `<thead><tr><th>Trip</th><th class="num">Share</th><th class="num">Max cargo + gear</th></tr></thead><tbody>${
    lim.map(([t, s]) => `<tr><td>${t}</td><td class="num">${pct(s)}</td><td class="num">${fmt(S.capital * s)}</td></tr>`).join("")}</tbody>`;
}
function renderGuide() {
  $("#route-guide-body").innerHTML = (window.GUIDE || []).map((g) => `<div class="guide-sec"><h3>${esc(g.title)}</h3><ul>${
    g.items.map(([t, src]) => `<li>${esc(t)} <span class="src">(${esc(src)})</span></li>`).join("")}</ul></div>`).join("") +
    `<p class="hint">Confidence notes: “2+ sources” means independent guides agree; “1 source” means one fan guide said it. The official wiki could not be checked. When the game disagrees with this page, trust the game.</p>`;
}

// ---------- tracker ----------
let TRACK = store.get("track", []);
function renderTrack() {
  TRACK.sort((a, b) => a.date.localeCompare(b.date));
  const rows = TRACK.map((e, i) => ({ ...e, i, change: i ? e.silver - TRACK[i - 1].silver : null }));
  renderTable($("#tr-table"), [
    { key: "date", label: "Date" }, { key: "silver", label: "Silver", num: true },
    { key: "change", label: "Change", num: true, cls: signCls("change"), html: (r) => r.change == null ? "—" : (r.change > 0 ? "+" : "") + fmt(r.change) },
    { key: "method", label: "Activity" }, { key: "note", label: "Note" },
    { key: "i", label: "", html: (r) => `<button data-del="${r.i}" aria-label="Delete entry">Delete</button>` },
  ], rows.slice().reverse(), { empty: "No entries yet. Log today's silver to start.", rerender: renderTrack });
  $("#tr-table").querySelectorAll("[data-del]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation(); TRACK.splice(+b.dataset.del, 1); store.set("track", TRACK); renderTrack();
  });
  const chart = $("#tr-chart"), sum = $("#tr-summary");
  if (TRACK.length < 2) { chart.innerHTML = ""; sum.innerHTML = `<p class="hint">Add at least two days to see a trend.</p>`; return; }
  chart.innerHTML = spark(TRACK.map((e) => e.silver), TRACK.map(() => 0));
  const first = TRACK[0], last = TRACK.at(-1);
  const days = Math.max(1, (Date.parse(last.date) - Date.parse(first.date)) / 864e5);
  const byM = {};
  rows.forEach((r) => { if (r.change != null) (byM[r.method] ||= []).push(r.change); });
  const ranked = Object.entries(byM).map(([m, a]) => [m, a.reduce((x, y) => x + y, 0) / a.length]).sort((a, b) => b[1] - a[1]);
  sum.innerHTML = `<p>${fmt(last.silver - first.silver)} silver over ${Math.round(days)} days, about <b>${fmt((last.silver - first.silver) / days)}</b> a day.</p>
    ${ranked.length ? `<p class="hint">Average change by activity: ${ranked.map(([m, v]) => `${esc(m)} ${v >= 0 ? "+" : ""}${fmt(v)}`).join(" · ")}</p>` : ""}`;
}
function initTracker() {
  $("#tr-date").value = new Date().toISOString().slice(0, 10);
  $("#tr-form").addEventListener("submit", (e) => {
    e.preventDefault();
    TRACK.push({ date: $("#tr-date").value, silver: +$("#tr-silver").value, method: $("#tr-method").value, note: $("#tr-note").value.trim() });
    store.set("track", TRACK); $("#tr-silver").value = ""; $("#tr-note").value = ""; renderTrack();
  });
  const io = $("#tr-io");
  $("#tr-export").onclick = async () => {
    io.hidden = false; io.value = JSON.stringify(TRACK); io.select();
    try { await navigator.clipboard.writeText(io.value); setStatus("Tracker data copied. Paste it into Import on your other device."); }
    catch { setStatus("Select the text in the box and copy it."); }
  };
  $("#tr-import-btn").onclick = () => {
    if (io.hidden || !io.value.trim()) { io.hidden = false; io.value = ""; io.focus(); return; }
    try {
      const add = JSON.parse(io.value);
      if (!Array.isArray(add)) throw new Error();
      const key = (e) => e.date + "|" + e.silver + "|" + e.method;
      const have = new Set(TRACK.map(key));
      add.filter((e) => e && e.date && isFinite(e.silver) && !have.has(key(e))).forEach((e) => TRACK.push(e));
      store.set("track", TRACK); io.value = ""; io.hidden = true; renderTrack(); setStatus("Tracker data imported.");
    } catch { setStatus("That text isn't tracker data. Use Export on the other device and paste all of it.", true); }
  };
}

// ---------- settings + assumptions ----------
function renderAssumptions() {
  $("#assumptions").innerHTML = [
    `Market tax ${pct(tax())} (${S.premium ? "with" : "without"} Premium), plus a ${pct(SETUP_FEE)} fee when you post an order. Filling a buy order skips that fee.`,
    `Refining return in the bonus city: ${pct(RR.refine.bonus[0])} without focus, ${pct(RR.refine.bonus[1])} with focus. Crafting: ${pct(RR.craft.bonus[0])} / ${pct(RR.craft.bonus[1])} in the bonus city. These come from a community guide; confirm them on the crafting screen.`,
    `Station fees, which depend on the station owner, are not included.`,
    `Prices older than ${S.maxAge} hours are ignored. Prices come from players running the Data Project client, so quiet items may have no price at all.`,
    `Risk setting “${S.risk}”${S.risk === "safe" ? " hides Caerleon and the Black Market." : " includes Caerleon and the Black Market."}`,
    `Normal quality, no enchantment. Focus cost is the base cost; your spec lowers it.`,
  ].map((t) => `<li>${esc(t)}</li>`).join("");
}
function rerenderAll() { renderAssumptions(); renderRisk(); if (!DATA) return; renderRefine(); renderCraft(); renderFlip(); renderGather(); }
function bindSettings() {
  const bind = (sel, key, parse = (v) => v, prop = "value") => {
    const el = $(sel); el[prop] = S[key];
    el.addEventListener("change", () => { S[key] = parse(el[prop]); saveSettings(); rerenderAll(); });
  };
  bind("#set-premium", "premium", Boolean, "checked");
  bind("#set-focus", "focus", Boolean, "checked");
  bind("#set-capital", "capital", (v) => Math.max(0, +v || 0));
  bind("#set-maxtier", "maxTier", Number);
  bind("#set-risk", "risk");
  bind("#set-maxage", "maxAge", Number);
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + name));
  store.set("tab", name);
}

// ---------- boot ----------
async function boot() {
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  const hash = location.hash.slice(1);
  showTab(document.getElementById("tab-" + hash) ? hash : store.get("tab", "start"));
  bindSettings(); initTracker(); renderGuide(); renderTrack(); rerenderAll();
  ["#rk-cargo", "#rk-gear", "#rk-profit", "#rk-p"].forEach((s) => $(s).addEventListener("input", renderRisk));
  try {
    DATA = await (await fetch("data/items.json?v=" + VERSION)).json();
  } catch {
    setStatus("Couldn't load item data. Reload the page.", true); return;
  }
  $("#built").textContent = DATA.built;
  for (const g of [DATA.raw, DATA.refine, DATA.craft]) for (const r of g) KG[r.id] = r.kg;
  const cats = [...new Set(DATA.craft.map((c) => c.cat))].sort();
  $("#cr-cat").innerHTML = `<option value="">All</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#cr-tier").value = String(Math.min(S.maxTier, 8));
  ["#ref-type", "#ref-buy"].forEach((s) => $(s).addEventListener("change", renderRefine));
  ["#cr-tier", "#cr-cat", "#cr-noart"].forEach((s) => $(s).addEventListener("change", renderCraft));
  $("#ga-tier").value = String(Math.min(8, Math.max(4, S.maxTier)));
  $("#ga-tier").addEventListener("change", renderGather);
  ["#fl-set", "#fl-mode"].forEach((s) => $(s).addEventListener("change", renderFlip));
  const refineIds = () => DATA.refine.flatMap((r) => [r.id, ...r.in.map(([i]) => i)]);
  $("#ref-load").onclick = async () => { await loadPrices(refineIds(), "refining"); renderRefine(); };
  $("#cr-load").onclick = async () => { await loadPrices(craftIds(), "crafting"); renderCraft(); };
  $("#fl-load").onclick = async () => { await loadPrices(flipIds(), "flipping"); renderFlip(); };
  $("#ga-load").onclick = async () => { await loadPrices(DATA.raw.map((r) => r.id), "gathering"); renderGather(); };
  rerenderAll();
  if (Object.keys(RAW).length) setStatus("Showing saved prices. Press Load to refresh.");
}
boot();
