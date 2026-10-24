// Endless maptap-style practice: prompt a place, click a guess, learn from the reveal.
'use strict';

const Practice = (() => {
  const HIST_KEY = 'mt.practice.v1';
  let pool = null;
  let session = null;   // {rounds: [], snap, opts}
  let round = null;     // {target, guess, marker, phase, hints, timer, deadline}
  let markers = [];

  // ---- pool ---------------------------------------------------------------
  function buildPool() {
    if (pool) return pool;
    pool = [];
    const taken = new Set();
    for (const s of Geo.seenByLabel.values()) {
      pool.push({ label: s.label, lat: s.lat, lon: s.lon, cc: s.cc, pop: s.pop, src: 'seen' });
      taken.add(Geo.norm(s.label.split(',')[0]) + '|' + s.cc);
    }
    for (const c of Geo.cities) {
      if (!(c.flag === 2 || c.pop >= 250000 || (c.flag === 1 && c.pop >= 40000))) continue;
      if (taken.has(Geo.norm(c.name) + '|' + c.cc)) continue;
      pool.push({ label: Geo.cityLabel(c), lat: c.lat, lon: c.lon, cc: c.cc, pop: c.pop,
        src: 'city', capital: c.flag === 2, name: c.name });
    }
    for (const p of pool) p.cont = Geo.continentOf(p.cc);
    return pool;
  }

  function regionOptions() {
    const p = buildPool();
    const conts = [...new Set(p.map(x => x.cont).filter(Boolean))].sort();
    const counts = {};
    for (const x of p) counts[x.cc] = (counts[x.cc] || 0) + 1;
    const ccs = Object.keys(counts).filter(cc => counts[cc] >= 6)
      .sort((a, b) => Geo.countryName(a).localeCompare(Geo.countryName(b)));
    return [['world', 'Whole world'], ...conts.map(c => ['cont:' + c, c]),
      ...ccs.map(cc => ['cc:' + cc, Geo.countryName(cc) + ` (${counts[cc]})`])];
  }

  function history() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) { /* private mode */ }
  }

  function candidates(opts) {
    let list;
    if (opts.source === 'weak') {
      list = Stats.weakSpots().map(w => Object.assign({ src: 'weak', cont: Geo.continentOf(w.cc) }, w));
    } else {
      list = buildPool().filter(p => opts.source === 'mixed' || p.src === opts.source);
    }
    const [kind, val] = opts.region.split(':');
    if (kind === 'cont') list = list.filter(p => p.cont === val);
    if (kind === 'cc') list = list.filter(p => p.cc === val);
    return list;
  }

  function pick(opts) {
    const list = candidates(opts);
    if (!list.length) return null;
    const h = history();
    const recent = new Set(session.rounds.slice(-30).map(r => r.target.label));
    let total = 0;
    const weights = list.map(p => {
      if (recent.has(p.label) && list.length > 40) return 0;
      let w = p.src === 'seen' ? 3 : p.capital ? 2 : 1;
      if (p.src === 'weak') w = Math.pow(105 - p.avg, 1.3);
      const mine = h[p.label];
      if (mine) w *= 1 + Math.max(0, 95 - mine.sum / mine.n) / 10;
      const stat = Stats.avgFor(p.label);
      if (stat !== null && p.src !== 'weak') w *= 1 + Math.max(0, 95 - stat) / 15;
      total += w;
      return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) if ((r -= weights[i]) <= 0) return list[i];
    return list[list.length - 1];
  }

  // ---- UI -------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const map = () => Layers.map;

  function clearMarkers() { markers.forEach(m => m.remove()); markers = []; }
  function pin(cls, lngLat) {
    const el = document.createElement('div');
    el.className = 'pin ' + cls;
    const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map());
    markers.push(m);
    return m;
  }

  function assistLayers(a) {
    return { none: [], borders: ['borders'], states: ['borders', 'states'],
      nature: ['borders', 'ranges', 'rivers'] }[a];
  }

  function start() {
    stop();
    const opts = { source: $('pSource').value, region: $('pRegion').value,
      assist: $('pAssist').value, timer: +$('pTimer').value };
    if (opts.source === 'weak' && !Stats.weakSpots().length) {
      UI.toast('Load your maptap stats in the "My stats" tab first.');
      return;
    }
    session = { rounds: [], snap: Layers.snapshot(), opts };
    $('pStart').textContent = 'Restart';
    nextRound();
  }

  function stop() {
    if (!session) return;
    if (round && round.timer) clearInterval(round.timer);
    clearMarkers();
    Layers.setData('game', null);
    Layers.clearHighlights();
    Layers.restore(session.snap);
    $('banner').hidden = true;
    $('card').hidden = true;
    session = null;
    round = null;
  }

  function nextRound() {
    if (round && round.timer) clearInterval(round.timer);
    clearMarkers();
    Layers.setData('game', null);
    Layers.clearHighlights();
    $('card').hidden = true;
    const target = pick(session.opts);
    if (!target) { UI.toast('No places match that filter.'); stop(); return; }
    round = { target, guess: null, phase: 'guess', hints: 0, hintText: [] };
    Layers.only(assistLayers(session.opts.assist));
    if (session.opts.timer) {
      round.deadline = Date.now() + session.opts.timer * 1000;
      round.timer = setInterval(() => {
        if (Date.now() >= round.deadline) submit(true); else renderBanner();
      }, 200);
    }
    renderBanner();
  }

  function renderBanner() {
    const n = session.rounds.length;
    // While revealing, the round just played is already in session.rounds.
    const inSet = round.phase === 'guess' ? n % 5 : (n - 1) % 5;
    const done = round.phase === 'guess' ? inSet : inSet + 1;
    const setTotal = session.rounds.slice(n - done).reduce((s, r) => s + r.score, 0);
    const timer = round.deadline && round.phase === 'guess'
      ? `<span class="timer">${Math.max(0, (round.deadline - Date.now()) / 1000).toFixed(1)}s</span>` : '';
    $('banner').innerHTML = `
      <div class="prompt">${round.target.label}</div>
      <div class="sub">
        <span>Round ${inSet + 1}/5 · set ${setTotal}</span>${timer}
        ${round.phase === 'guess' ? `<button id="bHint" title="H">Hint</button>
          <button id="bGuess" class="${round.guess ? '' : 'dim'}" title="Enter">Guess</button>
          <button id="bSkip" title="Show me">Show me</button>` : ''}
        <button id="bStop">Stop</button>
      </div>
      ${round.hintText.map(t => `<div class="hintline">${t}</div>`).join('')}`;
    $('banner').hidden = false;
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on('bHint', hint); on('bGuess', () => submit(false)); on('bStop', stop);
    on('bSkip', () => submit(true, true));
  }

  function onMapClick(e) {
    if (!session || !round || round.phase !== 'guess') return false;
    round.guess = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (round.guessMarker) round.guessMarker.setLngLat(e.lngLat);
    else round.guessMarker = pin('guess', e.lngLat);
    if (!round.deadline) renderBanner();
    return true;
  }

  function hint() {
    if (!round || round.phase !== 'guess') return;
    const t = round.target;
    const info = Learn.about(t, { cc: t.cc, pop: t.pop });
    const steps = [];
    steps.push(() => {
      Layers.highlightCountry(t.cc);
      Layers.set('borders', true);
      return `Country outlined: ${Geo.countryName(t.cc)}. ${partOf(t)}`;
    });
    if (info.state) steps.push(() => {
      Layers.highlightState(t.cc, info.state);
      Layers.set('states', true);
      return `State/province: ${info.state}`;
    });
    if (info.facts.length > 1) steps.push(() => info.facts[0].replace(/<\/?b>/g, ''));
    steps.push(() => {
      const off = Math.random() * 120, b = Math.random() * 360;
      const c = Layers.circlePolygon(t, off).geometry.coordinates[0][Math.floor(b / 360 * 64)];
      Layers.setData('game', { type: 'FeatureCollection',
        features: [Layers.circlePolygon({ lon: c[0], lat: c[1] }, 250)] });
      return 'It is inside the shaded circle.';
    });
    if (round.hints >= steps.length) return;
    round.hintText.push(steps[round.hints++]());
    renderBanner();
  }

  // "in the north-west of France", from the country's bounding box.
  function partOf(t) {
    const e = Geo.countryIndex.find(x => x.f.properties.iso === t.cc);
    if (!e) return '';
    // use the polygon that contains the target (ignore far-flung islands)
    let bb = e.bbox;
    for (const p of e.polys) {
      const b = Geo.bboxOf({ type: 'Polygon', coordinates: p });
      if (t.lon >= b[0] && t.lon <= b[2] && t.lat >= b[1] && t.lat <= b[3]) { bb = b; break; }
    }
    const fx = (t.lon - bb[0]) / (bb[2] - bb[0] || 1), fy = (t.lat - bb[1]) / (bb[3] - bb[1] || 1);
    const ns = fy > 0.66 ? 'north' : fy < 0.33 ? 'south' : '';
    const ew = fx > 0.66 ? 'east' : fx < 0.33 ? 'west' : '';
    const where = ns && ew ? `${ns}-${ew}` : ns || ew || 'centre';
    return `It's in the ${where} of the country.`;
  }

  function submit(force, giveUp) {
    if (!round || round.phase !== 'guess') return;
    if (!round.guess && !force) { UI.toast('Click the map to place a guess first.'); return; }
    if (round.timer) clearInterval(round.timer);
    round.phase = 'reveal';
    const t = round.target;
    const km = round.guess && !giveUp ? Geo.distKm(round.guess, t) : null;
    const score = km === null ? 0 : Geo.scoreFor(km);
    const rec = { target: t, guess: round.guess, km, score, hints: round.hints };
    session.rounds.push(rec);
    if (!giveUp) {
      const h = history();
      const e = h[t.label] || { n: 0, sum: 0 };
      e.n++; e.sum += score; e.last = Date.now();
      h[t.label] = e;
      saveHistory(h);
    }
    reveal(rec);
    renderBanner();
    renderLog();
  }

  function reveal(rec) {
    const t = rec.target;
    pin('answer', [t.lon, t.lat]);
    Layers.only(['borders', 'countryLabels', 'states', 'stateLabels', 'cities', 'cityLabels', 'rivers', 'ranges']);
    const info = Learn.about(t, { cc: t.cc, pop: t.pop, name: t.label.split(',')[0] });
    Layers.highlightCountry(t.cc);
    if (info.state) Layers.highlightState(t.cc, info.state);
    let guessLine = '';
    if (rec.guess) {
      Layers.setData('game', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: Geo.greatCircle(rec.guess, t) } }] });
      const gc = Geo.countryAt(rec.guess.lon, rec.guess.lat);
      const gs = Geo.stateAt(rec.guess.lon, rec.guess.lat);
      const gIso = gc && gc.properties.iso;
      if (gIso && gIso !== t.cc) {
        Layers.highlightCountry(gIso, 'wrong');
        guessLine = `<p class="score-bad">Your guess was in <b>${gc.properties.name}</b>${gs && gs.properties.iso === gIso ? ' (' + gs.properties.name + ')' : ''} — wrong country.</p>`;
      } else if (gIso && info.state && gs && gs.properties.name !== info.state) {
        guessLine = `<p class="score-ok">Right country, but you guessed in <b>${gs.properties.name}</b>, not ${info.state}.</p>`;
      } else if (!gIso) {
        guessLine = '<p class="score-bad">Your guess was in the sea.</p>';
      }
      const b = new maplibregl.LngLatBounds();
      b.extend([t.lon, t.lat]);
      b.extend([rec.guess.lon, rec.guess.lat]);
      if (rec.km > 30 && rec.km < 8000) map().fitBounds(b, { padding: UI.revealPadding(), maxZoom: 7, duration: 900 });
      else map().flyTo({ center: [t.lon, t.lat], zoom: Math.max(map().getZoom(), 5), duration: 900, padding: UI.revealPadding() });
    } else {
      map().flyTo({ center: [t.lon, t.lat], zoom: 5, duration: 900, padding: UI.revealPadding() });
    }
    const cls = rec.score >= 95 ? 'score-good' : rec.score >= 85 ? 'score-ok' : 'score-bad';
    const statAvg = Stats.avgFor(t.label);
    UI.card(`
      <button class="close" onclick="document.getElementById('card').hidden=true">×</button>
      <div class="big ${cls}">${rec.score}</div>
      <div>${rec.km === null ? 'No guess' : Geo.fmtKm(rec.km) + ' away'}${rec.hints ? ` · ${rec.hints} hint${rec.hints > 1 ? 's' : ''}` : ''}</div>
      <h3>${t.label}</h3>
      ${info.state ? `<div>${info.state}, ${info.country}</div>` : ''}
      ${guessLine}
      <ul>${info.facts.map(f => `<li>${f}</li>`).join('')}</ul>
      ${statAvg !== null ? `<p class="hint">Your maptap average here: ${statAvg}</p>` : ''}
      ${t.src === 'seen' ? '<p class="hint">maptap has asked about this place before.</p>' : ''}
      <button class="primary" id="bNext">${session.rounds.length % 5 === 0 ? 'Set done — next set' : 'Next'} (Enter)</button>`);
    $('bNext').onclick = nextRound;
    if (session.rounds.length % 5 === 0) {
      const set = session.rounds.slice(-5).reduce((s, r) => s + r.score, 0);
      UI.toast(`Set complete: ${set} / 500`);
    }
  }

  function renderLog() {
    const rs = session.rounds;
    const avg = rs.reduce((s, r) => s + r.score, 0) / rs.length;
    const rows = rs.slice().reverse().slice(0, 50).map((r, i) => `
      <tr class="click" data-i="${rs.length - 1 - i}"><td>${r.target.label}</td>
      <td class="num ${r.score >= 95 ? 'score-good' : r.score >= 85 ? 'score-ok' : 'score-bad'}">${r.score}</td>
      <td class="num">${r.km === null ? '—' : Geo.fmtKm(r.km)}</td></tr>`).join('');
    $('pLog').innerHTML = `<h2>This session</h2><p>${rs.length} rounds · average <b>${avg.toFixed(1)}</b>
      (≈ ${Math.round(avg * 10)} per daily)</p>
      <table><tr><th>Place</th><th class="num">Pts</th><th class="num">Miss</th></tr>${rows}</table>`;
    for (const tr of $('pLog').querySelectorAll('tr.click')) tr.onclick = () => {
      const r = rs[+tr.dataset.i];
      map().flyTo({ center: [r.target.lon, r.target.lat], zoom: 5 });
    };
  }

  function onKey(e) {
    if (!session || !round) return false;
    if (e.key === 'Enter' || e.key === ' ') {
      if (round.phase === 'guess') submit(false); else nextRound();
      return true;
    }
    if (e.key === 'h' || e.key === 'H') { hint(); return true; }
    if (e.key === 'Escape') { stop(); return true; }
    return false;
  }

  return { start, stop, onMapClick, onKey, regionOptions, buildPool,
    get active() { return !!session; } };
})();
