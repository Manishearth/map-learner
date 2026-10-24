// Endless maptap-style practice. Guessing immediately records the round, shows
// its result in the corner card and moves straight on to the next place.
'use strict';

const Practice = (() => {
  const HIST_KEY = 'mt.practice.v1';
  const HOLD_MS = 2000;
  const $ = id => document.getElementById(id);
  const map = () => Layers.map;

  let pool = null;
  let session = null;  // {rounds, snap, opts, overlays, hintsVisible, viewing}
  let round = null;    // {target, guess, guessMarker, hints, hintText, timer, deadline}
  let reviewMarkers = [];

  // ---- pool ---------------------------------------------------------------
  const sigmoid = z => 1 / (1 + Math.exp(-z));

  function buildPool() {
    if (pool) return pool;
    pool = [];
    const taken = new Set();
    for (const s of Geo.seenByLabel.values()) {
      pool.push({ label: s.label, lat: s.lat, lon: s.lon, cc: s.cc, pop: s.pop, src: 'seen', p: 0.5 });
      taken.add(Geo.norm(s.label.split(',')[0]) + '|' + s.cc);
    }
    // Generated places: cities our maptap-likeliness model rates >= ~7%.
    for (const c of Geo.cities) {
      if (c.likely < -250 || taken.has(Geo.norm(c.name) + '|' + c.cc)) continue;
      pool.push({ label: Geo.cityLabel(c), lat: c.lat, lon: c.lon, cc: c.cc, pop: c.pop,
        src: 'city', p: sigmoid(c.likely / 100), name: c.name });
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
      let w = p.src === 'weak' ? Math.pow(105 - p.avg, 1.3) : (p.src === 'seen' ? 1.5 : 1) * (0.3 + p.p);
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

  // ---- session --------------------------------------------------------------
  function pin(cls, lngLat, list) {
    const el = document.createElement('div');
    el.className = 'pin ' + cls;
    const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map());
    if (list) list.push(m);
    return m;
  }

  function start() {
    stop();
    const opts = { source: $('pSource').value, region: $('pRegion').value, timer: +$('pTimer').value };
    if (opts.source === 'weak' && !Stats.weakSpots().length) {
      UI.toast('Load your maptap stats in the "My stats" tab first.');
      return;
    }
    session = { rounds: [], snap: Layers.snapshot(), opts, overlays: false, hintsVisible: true, viewing: -1 };
    Layers.only([]);   // practice starts clean; O brings the Explore overlays back
    $('pStart').textContent = 'Restart';
    $('pLog').innerHTML = '';
    nextRound();
  }

  function stop() {
    if (!session) return;
    endRound();
    clearReview();
    Layers.restore(session.snap);
    Layers.showHints(true);
    $('banner').hidden = true;
    $('card').hidden = true;
    session = null;
  }

  function endRound() {
    if (!round) return;
    if (round.timer) clearInterval(round.timer);
    if (round.guessMarker) round.guessMarker.remove();
    cancelHold();
    Layers.setData('game', null);
    Layers.highlightCountry(null);
    Layers.highlightState(null, null);
    round = null;
  }

  function nextRound() {
    endRound();
    const target = pick(session.opts);
    if (!target) { UI.toast('No places match that filter.'); stop(); return; }
    round = { target, guess: null, hints: 0, hintStep: 0, hintText: [] };
    if (session.opts.timer) {
      round.deadline = Date.now() + session.opts.timer * 1000;
      round.timer = setInterval(() => {
        if (Date.now() >= round.deadline) submit(); else renderTimer();
      }, 100);
    }
    renderBanner();
  }

  function setInfo() {
    const n = session.rounds.length;
    const inSet = n % 5;
    return { roundNo: inSet + 1, setTotal: session.rounds.slice(n - inSet).reduce((s, r) => s + r.score, 0) };
  }

  function renderTimer() {
    const el = $('pTimerOut');
    if (el && round && round.deadline) el.textContent = Math.max(0, (round.deadline - Date.now()) / 1000).toFixed(1) + 's';
  }

  function renderBanner() {
    const { roundNo, setTotal } = setInfo();
    const btn = (id, label, key, on) =>
      `<button id="${id}" title="${key}" class="${on ? 'on' : ''}">${label}</button>`;
    $('banner').innerHTML = `
      <div class="prompt">${round.target.label}</div>
      <div class="sub">
        <span>Round ${roundNo}/5 · set ${setTotal}</span>
        ${round.deadline ? '<span class="timer" id="pTimerOut"></span>' : ''}
        ${btn('bHint', 'Hint', 'H')}
        ${btn('bOutline', 'Outline', 'C')}
        ${btn('bOverlays', 'Overlays', 'O', session.overlays)}
        ${btn('bHintVis', 'Hint layers', 'V', session.hintsVisible)}
        ${round.guess && !round.deadline ? btn('bGuess', 'Guess', 'Enter') : ''}
        ${btn('bSkip', 'Skip', 'S')}
        ${btn('bStop', 'Stop', 'Esc')}
      </div>
      ${round.hintText.map(t => `<div class="hintline">${t}</div>`).join('')}`;
    $('banner').hidden = false;
    renderTimer();
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on('bHint', hint); on('bOutline', outline); on('bOverlays', toggleOverlays);
    on('bHintVis', toggleHintLayers); on('bGuess', () => submit()); on('bSkip', () => submit(true));
    on('bStop', stop);
  }

  function toggleOverlays() {
    session.overlays = !session.overlays;
    if (session.overlays) Layers.restore(session.snap); else Layers.only([]);
    renderBanner();
  }
  function toggleHintLayers() {
    session.hintsVisible = !session.hintsVisible;
    Layers.showHints(session.hintsVisible);
    renderBanner();
  }

  // ---- guessing -------------------------------------------------------------
  let hold = null;   // {x, y, lngLat, el, timer}
  let suppressClick = false;

  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.el.remove();
    hold = null;
  }

  function onPointerDown(e) {
    if (!session || !round || e.button > 0) return;
    cancelHold();
    suppressClick = false;   // only the click ending the hold that guessed is ignored
    const rect = map().getContainer().getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const el = document.createElement('div');
    el.className = 'holdring';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    map().getContainer().appendChild(el);
    hold = { x: e.clientX, y: e.clientY, el, timer: setTimeout(() => {
      const ll = map().unproject([x, y]);
      cancelHold();
      suppressClick = true;   // the mouseup that follows would otherwise re-guess
      place({ lat: ll.lat, lon: ll.lng });
      submit();
    }, HOLD_MS) };
  }
  function onPointerMove(e) {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
  }
  function onPointerUp() { cancelHold(); }

  function place(pt) {
    round.guess = pt;
    if (round.guessMarker) round.guessMarker.setLngLat([pt.lon, pt.lat]);
    else round.guessMarker = pin('guess', [pt.lon, pt.lat]);
  }

  // MapLibre only fires 'click' for non-drag clicks, so panning never guesses.
  function onMapClick(e) {
    if (!session || !round) return false;
    if (suppressClick) { suppressClick = false; return true; }
    place({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    if (session.opts.timer) submit();   // speed mode: tap = guess
    else renderBanner();
    return true;
  }

  // ---- hints ----------------------------------------------------------------
  function outline() {
    if (!round) return;
    const t = round.target;
    const info = Learn.about(t, { cc: t.cc, pop: t.pop });
    if (info.state) Layers.highlightState(t.cc, info.state);
    else Layers.highlightCountry(t.cc);
    if (!session.hintsVisible) toggleHintLayers();
    round.hints++;
    round.hintText.push(info.state ? `Outlined: ${info.state}` : `Outlined: ${Geo.countryName(t.cc)}`);
    renderBanner();
  }

  function hint() {
    if (!round) return;
    const t = round.target;
    const info = Learn.about(t, { cc: t.cc, pop: t.pop });
    const steps = [];
    steps.push(() => {
      Layers.highlightCountry(t.cc);
      return `Country outlined: ${Geo.countryName(t.cc)}. ${partOf(t)}`;
    });
    if (info.state) steps.push(() => {
      Layers.highlightState(t.cc, info.state);
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
    if (round.hintStep >= steps.length) return;
    if (!session.hintsVisible) toggleHintLayers();
    round.hintText.push(steps[round.hintStep++]());
    round.hints++;
    renderBanner();
  }

  // "in the north-west of the country", from the bbox of the polygon containing it.
  function partOf(t) {
    const e = Geo.countryIndex.find(x => x.f.properties.iso === t.cc);
    if (!e) return '';
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

  // ---- results --------------------------------------------------------------
  function submit(skip) {
    if (!round) return;
    const t = round.target;
    const guess = skip ? null : round.guess;
    const km = guess ? Geo.distKm(guess, t) : null;
    const score = km === null ? 0 : Geo.scoreFor(km);
    const rec = { target: t, guess, km, score, hints: round.hints, skipped: !!skip };
    if (!skip) {
      const h = history();
      const e = h[t.label] || { n: 0, sum: 0 };
      e.n++; e.sum += score; e.last = Date.now();
      h[t.label] = e;
      saveHistory(h);
    }
    session.rounds.push(rec);
    const n = session.rounds.length;
    if (n % 5 === 0) {
      const set = session.rounds.slice(-5).reduce((s, r) => s + r.score, 0);
      UI.toast(`Set complete: ${set} / 500`);
    }
    nextRound();
    showRound(n - 1, false);
    renderLog();
  }

  function clearReview() {
    reviewMarkers.forEach(m => m.remove());
    reviewMarkers = [];
    Layers.setData('review', null);
    Layers.review(null);
  }

  // Draw a past round on the map (answer, guess, line, right/wrong country) and
  // show its learning card. fly: also move the map to it.
  function showRound(i, fly) {
    const rec = session.rounds[i];
    if (!rec) return;
    session.viewing = i;
    clearReview();
    const t = rec.target;
    const info = Learn.about(t, { cc: t.cc, pop: t.pop, name: t.label.split(',')[0] });
    pin('answer small', [t.lon, t.lat], reviewMarkers);
    let guessLine = '', wrongIso = null;
    if (rec.guess) {
      pin('guess small', [rec.guess.lon, rec.guess.lat], reviewMarkers);
      Layers.setData('review', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: Geo.greatCircle(rec.guess, t) } }] });
      const gc = Geo.countryAt(rec.guess.lon, rec.guess.lat);
      const gs = Geo.stateAt(rec.guess.lon, rec.guess.lat);
      const gIso = gc && gc.properties.iso;
      if (gIso && gIso !== t.cc) {
        wrongIso = gIso;
        guessLine = `<p class="score-bad">You guessed in <b>${gc.properties.name}</b>${gs && gs.properties.iso === gIso ? ' (' + gs.properties.name + ')' : ''} — wrong country.</p>`;
      } else if (gIso && info.state && gs && gs.properties.name !== info.state) {
        guessLine = `<p class="score-ok">Right country, but you guessed in <b>${gs.properties.name}</b>, not ${info.state}.</p>`;
      } else if (!gIso) {
        guessLine = '<p class="score-bad">You guessed in the sea.</p>';
      }
    }
    Layers.review(t.cc, info.state, wrongIso);
    if (fly) {
      if (rec.guess && rec.km > 30 && rec.km < 8000) {
        // cameraForBounds throws in globe projection (MapLibre 5.6), so frame
        // the guess and answer by hand: midpoint of the arc, zoom to fit its length.
        const arc = Geo.greatCircle(rec.guess, t, 2);
        const pad = UI.revealPadding();
        const cont = map().getContainer();
        const avail = Math.max(150, Math.min(cont.clientWidth - pad.left - pad.right, cont.clientHeight - pad.top - pad.bottom));
        const zoom = Math.log2(avail * 40075 / (512 * rec.km * 1.3));
        map().flyTo({ center: arc[1], zoom: Math.max(1.5, Math.min(7, zoom)), padding: pad, duration: 800 });
      } else {
        map().flyTo({ center: [t.lon, t.lat], zoom: Math.max(map().getZoom(), 4.5), duration: 800, padding: UI.revealPadding() });
      }
    }
    const cls = rec.score >= 95 ? 'score-good' : rec.score >= 85 ? 'score-ok' : 'score-bad';
    const statAvg = Stats.avgFor(t.label);
    const n = session.rounds.length;
    UI.card(`
      <div class="nav"><button id="cPrev" ${i === 0 ? 'disabled' : ''}>‹</button>
        <span>Round ${i + 1} of ${n}${i === n - 1 ? ' (last)' : ''}</span>
        <button id="cShow">Show on map</button>
        <button id="cNext" ${i === n - 1 ? 'disabled' : ''}>›</button>
        <button id="cClose">×</button></div>
      <div class="big ${cls}">${rec.score}</div>
      <div>${rec.skipped ? 'Skipped' : rec.km === null ? 'No guess' : Geo.fmtKm(rec.km) + ' away'}${rec.hints ? ` · ${rec.hints} hint${rec.hints > 1 ? 's' : ''}` : ''}</div>
      <h3>${t.label}</h3>
      ${info.state ? `<div>${info.state}, ${info.country}</div>` : ''}
      ${guessLine}
      <ul>${info.facts.map(f => `<li>${f}</li>`).join('')}</ul>
      ${statAvg !== null ? `<p class="hint">Your maptap average here: ${statAvg}</p>` : ''}
      ${t.src === 'seen' ? '<p class="hint">maptap has asked about this place before.</p>' : ''}`);
    $('cPrev').onclick = () => showRound(i - 1, true);
    $('cNext').onclick = () => showRound(i + 1, true);
    $('cShow').onclick = () => showRound(i, true);
    $('cClose').onclick = () => { $('card').hidden = true; clearReview(); session.viewing = -1; renderLog(); };
    renderLog();
  }

  function renderLog() {
    const rs = session.rounds;
    if (!rs.length) return;
    const avg = rs.reduce((s, r) => s + r.score, 0) / rs.length;
    const rows = rs.slice().reverse().slice(0, 100).map((r, k) => {
      const i = rs.length - 1 - k;
      return `<tr class="click ${i === session.viewing ? 'sel' : ''}" data-i="${i}"><td>${r.target.label}</td>
        <td class="num ${r.score >= 95 ? 'score-good' : r.score >= 85 ? 'score-ok' : 'score-bad'}">${r.score}</td>
        <td class="num">${r.km === null ? '—' : Geo.fmtKm(r.km)}</td></tr>`;
    }).join('');
    $('pLog').innerHTML = `<h2>This session</h2><p>${rs.length} rounds · average <b>${avg.toFixed(1)}</b>
      (≈ ${Math.round(avg * 10)} per daily)</p>
      <p class="hint">Click a round to see it on the map.</p>
      <table><tr><th>Place</th><th class="num">Pts</th><th class="num">Miss</th></tr>${rows}</table>`;
    for (const tr of $('pLog').querySelectorAll('tr.click')) tr.onclick = () => showRound(+tr.dataset.i, true);
  }

  function onKey(e) {
    if (!session || !round) return false;
    const k = e.key.toLowerCase();
    if (k === 'enter' || k === ' ') { if (round.guess) submit(); return true; }
    if (k === 'h') { hint(); return true; }
    if (k === 'c') { outline(); return true; }
    if (k === 'o') { toggleOverlays(); return true; }
    if (k === 'v') { toggleHintLayers(); return true; }
    if (k === 's') { submit(true); return true; }
    if (k === 'arrowleft' && session.viewing > 0) { showRound(session.viewing - 1, true); return true; }
    if (k === 'arrowright' && session.viewing < session.rounds.length - 1) { showRound(session.viewing + 1, true); return true; }
    if (k === 'escape') { stop(); return true; }
    return false;
  }

  return { start, stop, onMapClick, onKey, onPointerDown, onPointerMove, onPointerUp,
    regionOptions, buildPool, get active() { return !!session; } };
})();
