// Streams full-detail coastlines, lakes, rivers and borders for the 10-degree
// cells on screen once you zoom in, and drops cells you've moved away from.
// The always-loaded base data is deliberately coarse so the page stays light
// enough for phones (mobile Safari kills pages that use too much memory).
'use strict';

const Detail = (() => {
  const CELL = 10;          // must match DETAIL_CELL in tools/build_data.py
  let MAX_VISIBLE = 24;     // cells drawn at once
  let MAX_CACHED = 48;      // cells kept in memory (least recently used dropped)
  const LAYERS = ['ocean', 'lakes', 'rivers', 'borders', 'states'];
  const available = new Set(MT.detailCells || []);
  const cache = new Map();  // key -> parsed cell data; Map order = recency
  const loading = new Map();
  let map, shownKey = '', broken = false, handedOver = false, timer = 0;

  function visibleCells() {
    if (map.getZoom() < Layers.DETAIL_ZOOM - 0.25) return [];
    const c = map.getCenter();
    const cv = map.getCanvas();
    // Radius to the farthest screen corner (fine at these zooms: the corners are on the globe).
    let r = 0;
    for (const [x, y] of [[0, 0], [cv.clientWidth, 0], [0, cv.clientHeight], [cv.clientWidth, cv.clientHeight]]) {
      const ll = map.unproject([x, y]);
      r = Math.max(r, Geo.distKm({ lat: c.lat, lon: c.lng }, { lat: ll.lat, lon: ll.lng }));
    }
    const dLat = r / 111 + 1;
    const lat0 = Math.max(-90, c.lat - dLat), lat1 = Math.min(89.999, c.lat + dLat);
    const cos = Math.max(0.05, Math.cos(Math.max(Math.abs(lat0), Math.abs(lat1)) * Math.PI / 180));
    const dLon = Math.min(180, r / (111 * cos) + 1);
    const cells = [];
    for (let y = Math.floor(lat0 / CELL); y <= Math.floor(lat1 / CELL); y++) {
      for (let x = Math.floor((c.lng - dLon) / CELL); x <= Math.floor((c.lng + dLon) / CELL); x++) {
        const xx = ((x % 36) + 54) % 36 - 18;   // wrap to -18..17
        const key = xx + '_' + y;
        if (!available.has(key) || cells.some(k => k.key === key)) continue;
        const ctr = { lat: (y + 0.5) * CELL, lon: (xx + 0.5) * CELL };
        cells.push({ key, d: Geo.distKm({ lat: c.lat, lon: c.lng }, ctr) });
      }
    }
    return cells.sort((a, b) => a.d - b.d).slice(0, MAX_VISIBLE).map(k => k.key);
  }

  function load(key) {
    if (loading.has(key)) return loading.get(key);
    const p = fetch(`data/detail/${key}.json`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => {
        cache.set(key, data);
        loading.delete(key);
        if (!handedOver) { handedOver = true; Layers.useDetail(); }
        while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
        schedule();
      })
      .catch(() => { broken = true; loading.delete(key); });   // e.g. file://: keep base layers
    loading.set(key, p);
    return p;
  }

  function update() {
    timer = 0;
    if (broken) return;
    const want = visibleCells();
    for (const k of want) {
      if (cache.has(k)) { const v = cache.get(k); cache.delete(k); cache.set(k, v); }   // mark recent
      else load(k);
    }
    const ready = want.filter(k => cache.has(k));
    const key = ready.join(',');
    if (key === shownKey) return;
    shownKey = key;
    for (const name of LAYERS) {
      Layers.setData('d-' + name, { type: 'FeatureCollection',
        features: ready.flatMap(k => cache.get(k)[name].features) });
    }
  }
  function schedule() { if (!timer) timer = setTimeout(update, 50); }

  function init(m) {
    map = m;
    map.on('moveend', schedule);
    map.once('styledata', schedule);
  }

  // Light mode (older phones): far fewer full-detail cells around the centre.
  function setLight(on) {
    [MAX_VISIBLE, MAX_CACHED] = on ? [6, 9] : [24, 48];
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
    shownKey = '';
    if (map) schedule();
  }

  return { init, setLight, get cachedCells() { return cache.size; } };
})();
