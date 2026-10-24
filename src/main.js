// Wire up the panel, map events and keyboard.
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  const PREFS = 'mt.ui.v1';
  const TOGGLES = ['ocean', 'graticule', 'borders', 'countryLabels', 'states', 'stateLabels',
    'cityLabels', 'seenCities', 'heatmap', 'ranges', 'deserts', 'peaks', 'rivers', 'seas'];
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
    const left = $('panel').classList.contains('collapsed') ? 40 : 380;
    return { left, right: 400, top: 110, bottom: 50 };
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
    Practice.start();
  }

  const sliderToCount = v => v <= 0 ? 0 : Math.round(10 * Math.pow(Geo.cities.length / 10, v / 100));

  function savePrefs() {
    const p = { basemap: $('basemap').value, cityCount: $('cityCount').value,
      capitalsOnly: $('capitalsOnly').checked };
    for (const t of TOGGLES) p[t] = $(t).checked;
    for (const id of ['pSource', 'pRegion', 'pAssist', 'pTimer', 'drillCount']) p[id] = $(id).value;
    try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { /* ignore */ }
    if (p.basemap) $('basemap').value = p.basemap;
    if (p.cityCount) $('cityCount').value = p.cityCount;
    if ('capitalsOnly' in p) $('capitalsOnly').checked = p.capitalsOnly;
    for (const t of TOGGLES) if (t in p) $(t).checked = p[t];
    for (const id of ['pSource', 'pRegion', 'pAssist', 'pTimer', 'drillCount']) if (p[id]) $(id).value = p[id];
  }

  function applyControls() {
    Layers.setBasemap($('basemap').value);
    for (const t of TOGGLES) Layers.set(t, $(t).checked);
    Layers.set('cities', true);
    const n = sliderToCount(+$('cityCount').value);
    $('cityCountOut').textContent = n.toLocaleString();
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
        if (b[2] - b[0] < 180) Layers.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 7 });
        else Layers.map.flyTo({ center: [r.f.properties.lx, r.f.properties.ly], zoom: 3 });
      }
    };
  }

  // ---- map clicks in explore mode -------------------------------------------------
  let popup = null;
  function exploreClick(e) {
    const map = Layers.map;
    const pt = e.point;
    const box = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
    const layers = ['city-dot', 'stats-dot', 'seen-dot'].filter(l => map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures(box, { layers });
    if (popup) popup.remove();
    let html;
    if (hits.length) {
      const h = hits[0];
      if (h.layer.id === 'city-dot') {
        const c = Geo.cities[h.properties.r];
        const kind = c.flag === 2 ? 'national capital' : c.flag === 1 ? 'state/provincial capital' : '';
        html = `<b>${c.name}</b><br>${Geo.cityLabel(c).split(', ').slice(1).join(', ')}<br>
          pop ${Geo.fmtPop(c.pop)}${kind ? ' · ' + kind : ''}<br><a href="#" id="popMore">Learn more…</a>`;
        popup = new maplibregl.Popup({ closeButton: true }).setLngLat([c.lon, c.lat]).setHTML(html).addTo(map);
        $('popMore').onclick = ev => { ev.preventDefault(); popup.remove(); showPlace(Object.assign({ label: Geo.cityLabel(c) }, c)); };
        return;
      }
      const label = h.properties.label || h.properties.n;
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

  function init() {
    const regionSel = $('pRegion');
    regionSel.innerHTML = Practice.regionOptions().map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    loadPrefs();

    const map = Layers.init('map');
    map.once('styledata', () => {
      applyControls();
      Stats.load();
      for (const b of document.querySelectorAll('#pStart, [data-drill]')) b.disabled = false;
    });
    for (const b of document.querySelectorAll('#pStart, [data-drill]')) b.disabled = true;
    map.on('click', e => {
      if (Practice.onMapClick(e)) return;
      if (Drill.onMapClick(e)) return;
      exploreClick(e);
    });
    map.on('mouseenter', 'city-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'city-dot', () => { map.getCanvas().style.cursor = ''; });

    for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => switchTab(b.dataset.tab);
    for (const id of [...TOGGLES, 'basemap', 'cityCount', 'capitalsOnly', 'drillCount']) {
      $(id).addEventListener('input', () => {
        savePrefs();
        if (Practice.active || Drill.active) UI.toast('Overlay changes apply after you stop the game.');
        else applyControls();
      });
    }
    for (const id of ['pSource', 'pRegion', 'pAssist', 'pTimer']) $(id).addEventListener('change', savePrefs);
    $('pStart').onclick = () => { Drill.stop(); Practice.start(); };
    for (const b of document.querySelectorAll('[data-drill]')) b.onclick = () => Drill.start(b.dataset.drill);
    $('statsFiles').onchange = e => Stats.addFiles(e.target.files);
    $('search').addEventListener('input', e => search(e.target.value));
    $('collapse').onclick = () => {
      $('panel').classList.add('collapsed');
      map.easeTo({ padding: { left: 0, top: 0, right: 0, bottom: 0 } });
    };
    $('expand').onclick = () => {
      $('panel').classList.remove('collapsed');
      map.easeTo({ padding: { left: 340, top: 0, right: 0, bottom: 0 } });
    };

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
      if (e.target.tagName === 'SELECT') return;
      if (Practice.onKey(e) || Drill.onKey(e)) e.preventDefault();
    });
  }

  return { init, toast, card, showPlace, startPractice, revealPadding };
})();

UI.init();
