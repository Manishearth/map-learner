// Load maptap CSV exports and turn them into "where am I losing points" views.
'use strict';

const Stats = (() => {
  const KEY = 'mt.stats.v1';
  const $ = id => document.getElementById(id);
  let raw = {};          // kind -> csv text
  let locs = [];         // [{label, cont, plays, best, avg, lat, lon, cc, pop}]
  let byLabel = new Map();
  let unresolved = [];

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0]) rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const head = rows.shift() || [];
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
  }

  function kindOf(text) {
    const head = text.replace(/^﻿/, '').split(/\r?\n/)[0];
    if (head.includes('Average Score')) return 'locations';
    if (head.includes('Opponent')) return 'versus';
    if (head.includes('Round 1 Score')) return 'history';
    return null;
  }

  function load() {
    try { raw = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { raw = {}; }
    rebuild();
  }

  async function addFiles(files) {
    for (const f of files) {
      const text = await f.text();
      const k = kindOf(text);
      if (k) raw[k] = text; else UI.toast(`Didn't recognise ${f.name}`);
    }
    try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch (e) { UI.toast('Could not save stats in this browser'); }
    rebuild();
  }

  function rebuild() {
    locs = []; unresolved = [];
    const h = new Map();
    // History rows give per-round scores too; fold them in when there's no locations export.
    if (raw.locations) {
      for (const r of parseCSV(raw.locations)) {
        h.set(r.Location, { label: r.Location, cont: (r.Continent || '').replace('_', ' '),
          plays: +r.Plays || 1, best: +r['Best Score'], avg: +r['Average Score'] });
      }
    } else if (raw.history) {
      for (const r of parseCSV(raw.history)) for (let i = 1; i <= 5; i++) {
        const l = r[`Round ${i} Location`], s = +r[`Round ${i} Score`];
        if (!l) continue;
        const e = h.get(l) || { label: l, cont: '', plays: 0, best: 0, sum: 0 };
        e.plays++; e.sum += s; e.best = Math.max(e.best, s); e.avg = +(e.sum / e.plays).toFixed(1);
        h.set(l, e);
      }
    }
    for (const e of h.values()) {
      const g = Geo.geocode(e.label);
      if (!g) { unresolved.push(e.label); continue; }
      Object.assign(e, { lat: g.lat, lon: g.lon, cc: g.cc, pop: g.pop || 0 });
      if (!e.cont) e.cont = Geo.continentOf(g.cc);
      locs.push(e);
    }
    byLabel = new Map(locs.map(e => [e.label, e]));
    Layers.setData('stats', { type: 'FeatureCollection', features: locs.map(e => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { label: e.label, avg: e.avg, plays: e.plays } })) });
    render();
  }

  const avgFor = label => byLabel.has(label) ? byLabel.get(label).avg : null;
  const weakSpots = () => locs.filter(e => e.avg < 92).sort((a, b) => a.avg - b.avg);

  function group(keyFn) {
    const g = new Map();
    for (const e of locs) {
      const k = keyFn(e);
      if (k === null) continue;
      const x = g.get(k) || { k, n: 0, plays: 0, sum: 0, lost: 0 };
      x.n++; x.plays += e.plays; x.sum += e.avg * e.plays; x.lost += (100 - e.avg) * e.plays;
      g.set(k, x);
    }
    for (const x of g.values()) x.avg = x.sum / x.plays;
    return [...g.values()];
  }

  const cls = s => s >= 95 ? 'score-good' : s >= 85 ? 'score-ok' : 'score-bad';

  function table(rows, cols, onclick) {
    return `<table><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr>
      ${rows.map((r, i) => `<tr class="${onclick ? 'click' : ''}" data-i="${i}">${cols.map(c =>
        `<td class="${c.num ? 'num' : ''} ${c.cls ? c.cls(r) : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  function render() {
    const out = $('statsOut');
    if (!out) return;
    if (!locs.length) {
      out.innerHTML = '<p class="hint">No stats loaded yet.</p>';
      return;
    }
    const totalPlays = locs.reduce((s, e) => s + e.plays, 0);
    const overall = locs.reduce((s, e) => s + e.avg * e.plays, 0) / totalPlays;
    const lostTotal = locs.reduce((s, e) => s + (100 - e.avg) * e.plays, 0);

    const conts = group(e => e.cont || null).sort((a, b) => b.lost - a.lost);
    const ccs = group(e => e.cc).filter(x => x.plays >= 2).sort((a, b) => b.lost - a.lost).slice(0, 25);
    const worst = locs.slice().sort((a, b) => a.avg - b.avg).slice(0, 40);
    const popBucket = group(e => !e.pop ? 'Landmark / unknown' : e.pop < 100000 ? 'Small (<100k)'
      : e.pop < 1000000 ? 'Medium (100k–1M)' : 'Big (>1M)').sort((a, b) => a.avg - b.avg);
    const stateC = group(e => Geo.stateCountries.has(e.cc) ? 'Countries with states (US, BR, IN, CN, RU…)' : 'Other countries')
      .sort((a, b) => a.avg - b.avg);

    let versus = '';
    if (raw.versus) {
      const vs = parseCSV(raw.versus);
      const w = vs.filter(v => v.Result === 'WIN').length, l = vs.filter(v => v.Result === 'LOSS').length;
      const elo = vs.reduce((s, v) => s + (+v['Elo Change'] || 0), 0);
      const mine = vs.reduce((s, v) => s + +v['My Score'], 0) / vs.length;
      const theirs = vs.reduce((s, v) => s + +v['Their Score'], 0) / vs.length;
      versus = `<h2>Versus</h2><p>${w}W–${l}L · net Elo ${elo >= 0 ? '+' : ''}${elo} ·
        avg ${mine.toFixed(0)} vs opponents' ${theirs.toFixed(0)}</p>`;
    }
    let daily = '';
    if (raw.history) {
      const hs = parseCSV(raw.history).sort((x, y) => x.Date.localeCompare(y.Date))
        .map(r => +r.Score).filter(Boolean);
      const half = Math.floor(hs.length / 2);
      const b = hs.slice(0, half), a = hs.slice(half);   // b: older, a: recent
      const mean = x => x.reduce((s, v) => s + v, 0) / (x.length || 1);
      daily = `<h2>Daily</h2><p>${hs.length} dailies · average ${mean(hs).toFixed(0)}
        (older half ${mean(b).toFixed(0)} → recent half ${mean(a).toFixed(0)})</p>`;
    }

    out.innerHTML = `
      <label class="check"><input type="checkbox" id="statsOnMap"> Show my scores on the map</label>
      <p>${locs.length} places, ${totalPlays} plays · average <b>${overall.toFixed(1)}</b>
        (≈ ${Geo.fmtKm(Geo.kmFor(overall))} typical miss) · ${Math.round(lostTotal)} points lost overall</p>
      ${daily}${versus}
      <button class="primary" id="practiceWeak">Practice my ${weakSpots().length} weak spots</button>
      <h2>Where the points go — by continent</h2>
      ${table(conts, [
        { h: 'Continent', f: r => r.k }, { h: 'Plays', num: 1, f: r => r.plays },
        { h: 'Avg', num: 1, f: r => r.avg.toFixed(1), cls: r => cls(r.avg) },
        { h: 'Typical miss', num: 1, f: r => Geo.fmtKm(Geo.kmFor(r.avg)) },
        { h: '% of lost', num: 1, f: r => Math.round(100 * r.lost / lostTotal) + '%' }])}
      <h2>By country (most points lost)</h2>
      <p class="hint">Click a row to practise that country.</p>
      <div id="ccTable">${table(ccs, [
        { h: 'Country', f: r => Geo.countryName(r.k) }, { h: 'Plays', num: 1, f: r => r.plays },
        { h: 'Avg', num: 1, f: r => r.avg.toFixed(1), cls: r => cls(r.avg) },
        { h: 'Lost', num: 1, f: r => Math.round(r.lost) }], true)}</div>
      <h2>By place size</h2>
      ${table(popBucket, [{ h: 'Size', f: r => r.k }, { h: 'Plays', num: 1, f: r => r.plays },
        { h: 'Avg', num: 1, f: r => r.avg.toFixed(1), cls: r => cls(r.avg) }])}
      ${table(stateC, [{ h: 'Format', f: r => r.k }, { h: 'Plays', num: 1, f: r => r.plays },
        { h: 'Avg', num: 1, f: r => r.avg.toFixed(1), cls: r => cls(r.avg) }])}
      <h2>Worst places</h2>
      <p class="hint">Click to fly there and see why.</p>
      <div id="worstTable">${table(worst, [
        { h: 'Place', f: r => r.label }, { h: 'Avg', num: 1, f: r => r.avg, cls: r => cls(r.avg) },
        { h: '≈ miss', num: 1, f: r => Geo.fmtKm(Geo.kmFor(r.avg)) }], true)}</div>
      ${unresolved.length ? `<p class="hint">Couldn't place: ${unresolved.join('; ')}</p>` : ''}`;

    $('statsOnMap').checked = !!Layers.map.getLayer('stats-dot') &&
      Layers.map.getLayoutProperty('stats-dot', 'visibility') === 'visible';
    $('statsOnMap').onchange = e => Layers.vis('stats-dot', e.target.checked);
    $('practiceWeak').onclick = () => UI.startPractice({ source: 'weak', region: 'world' });
    for (const tr of document.querySelectorAll('#ccTable tr.click')) tr.onclick = () =>
      UI.startPractice({ source: 'mixed', region: 'cc:' + ccs[+tr.dataset.i].k });
    for (const tr of document.querySelectorAll('#worstTable tr.click')) tr.onclick = () => {
      const e = worst[+tr.dataset.i];
      UI.showPlace(e, `Your maptap average: <b class="${cls(e.avg)}">${e.avg}</b> over ${e.plays} play${e.plays > 1 ? 's' : ''}
        (≈ ${Geo.fmtKm(Geo.kmFor(e.avg))} miss)`);
    };
  }

  return { load, addFiles, avgFor, weakSpots, render, get places() { return locs; } };
})();
