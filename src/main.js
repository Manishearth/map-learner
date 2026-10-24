// Wire up the panel, map events and keyboard.
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  const PREFS = 'mt.ui.v2';   // bump to reset everyone to new defaults
  const TOGGLES = ['ocean', 'graticule', 'borders', 'countryLabels', 'states', 'stateLabels',
    'cityLabels', 'heatmap', 'ranges', 'deserts', 'peaks', 'rivers', 'seas'];
  let placeMarker = null, toastTimer = null;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function card(html) { $('card').innerHTML = html; $('card').hidden = false; }

  // Fly to a place and show its learning card.
  function showPlace(p, extra = '') {
    const map = Layers.map;
    if (placeMarker) placeMarker.remove();
    const el = document.createElement('div');
    el.className = 'pin answer';
    placeMarker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(4.5, Math.min(map.getZoom() + 1, 6)), padding: revealPadding() });
    const info = Learn.about(p, { cc: p.cc, pop: p.pop, name: (p.label || p.name).split(',')[0] });
    Layers.clearHighlights();
    if (info.cc) Layers.highlightCountry(info.cc);
    if (info.state) Layers.highlightState(info.cc, info.state);
    card(`<button class="close" id="cardClose">×</button>
      <h3>${p.label || p.name}</h3>
      ${info.state ? `<div>${info.state}, ${info.country}</div>` : ''}
      ${extra ? `<p>${extra}</p>` : ''}
      <ul>${info.facts.map(f => `<li>${f}</li>`).join('')}</ul>`);
    $('cardClose').onclick = () => {
      $('card').hidden = true;
      if (placeMarker) placeMarker.remove();
      placeMarker = null;
      Layers.clearHighlights();
    };
  }

  // Map padding that keeps a point clear of the side panel and the result card.
  function revealPadding() {
    const w = Layers.map.getContainer().clientWidth, h = Layers.map.getContainer().clientHeight;
    if (narrow()) {
      // Phone: banner on top, result card as a bottom sheet.
      const top = Math.min(h * 0.3, ($('banner').offsetHeight || 60) + 12);
      const bottom = Math.min(h * 0.45, $('card').hidden ? 40 : $('card').offsetHeight + 16);
      return { left: 10, right: 10, top, bottom };
    }
    let left = $('panel').classList.contains('collapsed') ? 40 : 360;
    let right = 390;   // room for the result card
    const spare = w - left - right - 150;
    if (spare < 0) { left = Math.max(20, left + spare / 2); right = Math.max(20, right + spare / 2); }
    return { left, right, top: Math.min(110, h / 5), bottom: Math.min(50, h / 10) };
  }

  function switchTab(name) {
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === 'tab-' + name);
    if (name === 'stats') Stats.render();
  }

  function startPractice(opts) {
    switchTab('practice');
    if (opts.source) $('pSource').value = opts.source;
    if (opts.region) $('pRegion').value = opts.region;
    Drill.stop();
    gameStarting();
    Practice.start();
  }

  // Slider 0..100 on a log scale: 3 .. ~1000 cities in view, or 3 .. ~30k
  // worldwide (a fixed set that doesn't change as you pan).
  let cityScope = 'view';
  const sliderSpan = () => cityScope === 'world' ? 4 : 2.5;
  const sliderToCount = v => v <= 0 ? 0 : Math.round(3 * Math.pow(10, v / 100 * sliderSpan()));
  const countToSlider = n => n <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(Math.log10(n / 3) / sliderSpan() * 100)));
  // The exact count shown. The slider sets it, but switching scope sets it
  // directly (the log-scale slider can't hit every count) and nudges the
  // slider to the nearest position.
  let cityCountN = null;
  function setCityScope(s) {
    cityScope = s;
    for (const b of document.querySelectorAll('#cityScope button')) {
      b.classList.toggle('on', b.dataset.scope === s);
      b.setAttribute('aria-checked', b.dataset.scope === s);
    }
  }

  function savePrefs() {
    const p = { basemap: $('basemap').value, cityCount: $('cityCount').value, cityCountN, cityMode: $('cityMode').value, cityScope,
      capitalsOnly: $('capitalsOnly').checked };
    for (const t of TOGGLES) p[t] = $(t).checked;
    for (const id of ['pSource', 'pRegion', 'pTimer', 'drillCount']) p[id] = $(id).value;
    try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { /* ignore */ }
    if (p.basemap) $('basemap').value = p.basemap;
    if (p.cityCount) $('cityCount').value = p.cityCount;
    if (p.cityMode) $('cityMode').value = p.cityMode;
    if (p.cityScope) setCityScope(p.cityScope);
    if (p.cityCountN != null) cityCountN = p.cityCountN;
    if ('capitalsOnly' in p) $('capitalsOnly').checked = p.capitalsOnly;
    for (const t of TOGGLES) if (t in p) $(t).checked = p[t];
    for (const id of ['pSource', 'pRegion', 'pTimer', 'drillCount']) if (p[id]) $(id).value = p[id];
  }

  function applyControls() {
    Layers.setBasemap($('basemap').value);
    for (const t of TOGGLES) Layers.set(t, $(t).checked);
    Layers.set('cities', true);
    if (cityCountN === null) cityCountN = sliderToCount(+$('cityCount').value);
    const n = cityCountN;
    $('cityCountOut').textContent = n.toLocaleString();
    Layers.setCityMode($('cityMode').value);
    Layers.setCityScope(cityScope);
    Layers.setCityCount(n);
    Layers.setCapitalsOnly($('capitalsOnly').checked);
    $('drillCountOut').textContent = $('drillCount').value;
  }

  // ---- search ---------------------------------------------------------------
  function search(q) {
    const nq = Geo.norm(q);
    const ul = $('searchResults');
    if (nq.length < 2) { ul.innerHTML = ''; return; }
    const res = [];
    for (const f of MT.countries.features) {
      if (Geo.norm(f.properties.name).startsWith(nq)) res.push({ kind: 'country', f });
    }
    for (const c of Geo.cities) {
      if (res.length >= 12) break;
      if (Geo.norm(c.name).startsWith(nq)) res.push({ kind: 'city', c });
    }
    ul.innerHTML = res.map((r, i) => `<li data-i="${i}">${r.kind === 'city'
      ? `${Geo.cityLabel(r.c)} <small>${Geo.fmtPop(r.c.pop)}</small>` : `<b>${r.f.properties.name}</b> <small>country</small>`}</li>`).join('');
    for (const li of ul.querySelectorAll('li')) li.onclick = () => {
      const r = res[+li.dataset.i];
      if (r.kind === 'city') showPlace(Object.assign({ label: Geo.cityLabel(r.c) }, r.c));
      else {
        const b = Geo.bboxOf(r.f.geometry);
        Layers.clearHighlights();
        Layers.highlightCountry(r.f.properties.iso);
        // fitBounds is broken in globe projection; size the zoom from the bbox diagonal.
        const km = b[2] - b[0] < 180 ? Geo.distKm({ lat: b[1], lon: b[0] }, { lat: b[3], lon: b[2] }) : 8000;
        const avail = Math.min(Layers.map.getContainer().clientWidth - 420, Layers.map.getContainer().clientHeight - 80);
        const zoom = Math.max(1.5, Math.min(7, Math.log2(Math.max(150, avail) * 40075 / (512 * Math.max(km, 30)))));
        Layers.map.flyTo({ center: [r.f.properties.lx, r.f.properties.ly], zoom });
      }
    };
  }

  // ---- map clicks in explore mode -------------------------------------------------
  let popup = null;
  function exploreClick(e) {
    const map = Layers.map;
    const pt = e.point;
    const box = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
    const layers = ['city-dot', 'stats-dot'].filter(l => map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures(box, { layers });
    if (popup) popup.remove();
    let html;
    if (hits.length) {
      const h = hits[0];
      if (h.layer.id === 'city-dot' && !h.properties.s) {
        const c = Geo.cities[h.properties.id];
        const kind = c.flag === 2 ? 'national capital' : c.flag === 1 ? 'state/provincial capital' : '';
        html = `<b>${c.name}</b><br>${Geo.cityLabel(c).split(', ').slice(1).join(', ')}<br>
          pop ${Geo.fmtPop(c.pop)}${kind ? ' · ' + kind : ''}<br><a href="#" id="popMore">Learn more…</a>`;
        popup = new maplibregl.Popup({ closeButton: true }).setLngLat([c.lon, c.lat]).setHTML(html).addTo(map);
        $('popMore').onclick = ev => { ev.preventDefault(); popup.remove(); showPlace(Object.assign({ label: Geo.cityLabel(c) }, c)); };
        return;
      }
      const label = h.properties.label || (h.properties.s ? Layers.places[h.properties.id].label : h.properties.n);
      const avg = Stats.avgFor(label);
      html = `<b>${label}</b>${avg !== null ? `<br>Your avg: ${avg}` : ''}`;
      popup = new maplibregl.Popup().setLngLat(h.geometry.coordinates).setHTML(html).addTo(map);
      return;
    }
    const cf = Geo.countryAt(e.lngLat.lng, e.lngLat.lat);
    const sf = Geo.stateAt(e.lngLat.lng, e.lngLat.lat);
    html = cf ? `<b>${cf.properties.name}</b>${sf ? '<br>' + sf.properties.name : ''}` : '<b>Sea</b>';
    html += `<br><small>${Geo.fmtLatLon(e.lngLat.lat, e.lngLat.lng)}</small>`;
    popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
  }

  // ---- panel / layout ---------------------------------------------------------
  // Phones get the panel as a bottom sheet; games hide it so the banner and
  // map are usable.
  const narrow = () => window.innerWidth < 700;
  const panelOpen = () => !$('panel').classList.contains('collapsed');
  let map = null;

  function panelPadding() {
    if (!panelOpen()) return { left: 0, top: 0, right: 0, bottom: 0 };
    if (narrow()) return { left: 0, top: 0, right: 0, bottom: $('panel').offsetHeight };
    return { left: 340, top: 0, right: 0, bottom: 0 };
  }
  function setPanel(open) {
    $('panel').classList.toggle('collapsed', !open);
    document.body.classList.toggle('collapsed', !open);
    if (map) map.easeTo({ padding: panelPadding(), duration: 300 });
  }
  // Starting a game on a phone: get the panel out of the way.
  function gameStarting() { if (narrow()) setPanel(false); }

  function showFatal(msg) {
    const el = document.createElement('div');
    el.id = 'fatal';
    el.innerHTML = `<h2>The map couldn't start</h2><p>${msg}</p>
      <p>Map Learner needs WebGL 2: a recent Chrome, Firefox, Edge or Safari (iOS 15+),
      with hardware acceleration / WebGL enabled.</p>`;
    document.body.appendChild(el);
  }

  function init() {
    // Surface errors instead of failing silently (handy for remote bug reports).
    window.addEventListener('error', e => toast('Error: ' + (e.message || e.error)));
    window.addEventListener('unhandledrejection', e => toast('Error: ' + (e.reason && e.reason.message || e.reason)));

    const regionSel = $('pRegion');
    regionSel.innerHTML = Practice.regionOptions().map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    loadPrefs();

    // Wire up every control before touching the map, so one failure there
    // can't leave the whole UI dead.
    for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => switchTab(b.dataset.tab);
    for (const id of [...TOGGLES, 'basemap', 'cityMode', 'cityCount', 'capitalsOnly', 'drillCount']) {
      $(id).addEventListener('input', () => {
        if (id === 'cityCount') cityCountN = sliderToCount(+$('cityCount').value);
        savePrefs();
        if (!map) return;
        if (Practice.active || Drill.active) UI.toast('Overlay changes apply after you stop the game.');
        else applyControls();
      });
    }
    for (const id of ['pSource', 'pRegion', 'pTimer']) $(id).addEventListener('change', savePrefs);
    for (const b of document.querySelectorAll('#cityScope button')) b.onclick = () => {
      if (b.dataset.scope === cityScope || !map) return;
      const keep = Layers.countKeepingVisible(b.dataset.scope);
      setCityScope(b.dataset.scope);
      if (keep !== null) cityCountN = keep;
      $('cityCount').value = countToSlider(cityCountN);
      savePrefs();
      applyControls();
    };
    $('pStart').onclick = () => { Drill.stop(); gameStarting(); Practice.start(); };
    for (const b of document.querySelectorAll('[data-drill]')) b.onclick = () => { gameStarting(); Drill.start(b.dataset.drill); };
    $('statsFiles').onchange = e => Stats.addFiles(e.target.files);
    $('search').addEventListener('input', e => search(e.target.value));
    $('collapse').onclick = () => setPanel(false);
    $('expand').onclick = () => setPanel(true);
    window.addEventListener('resize', () => { if (map) map.setPadding(panelPadding()); });
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
      if (e.target.tagName === 'SELECT') return;
      if (Practice.onKey(e) || Drill.onKey(e)) e.preventDefault();
    });

    for (const b of document.querySelectorAll('#pStart, [data-drill]')) b.disabled = true;
    try {
      map = Layers.init('map');
    } catch (err) {
      showFatal(String(err && err.message || err));
      return;
    }
    map.setPadding(panelPadding());
    map.on('error', e => {
      // Individual tile failures are routine (flaky network); report the rest.
      if (!e.tile && !e.sourceId) toast('Map error: ' + (e.error && e.error.message || e.error));
    });
    map.once('styledata', () => {
      applyControls();
      Stats.load();
      for (const b of document.querySelectorAll('#pStart, [data-drill]')) b.disabled = false;
    });
    map.on('click', e => {
      if (Practice.onMapClick(e)) return;
      if (Drill.onMapClick(e)) return;
      exploreClick(e);
    });
    map.on('mouseenter', 'city-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'city-dot', () => { map.getCanvas().style.cursor = ''; });
    const canvas = map.getCanvasContainer();
    canvas.addEventListener('pointerdown', e => Practice.onPointerDown(e));
    canvas.addEventListener('pointermove', e => Practice.onPointerMove(e));
    canvas.addEventListener('pointerup', e => Practice.onPointerUp(e));
    canvas.addEventListener('pointercancel', e => Practice.onPointerUp(e));
  }

  return { init, toast, card, showPlace, startPractice, revealPadding, narrow, panelOpen };
})();

UI.init();
