// Geometry helpers and indexes over the static data in MT.*.
'use strict';

const Geo = (() => {
  const R = 6371;
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  function distKm(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = b => DIRS[Math.round(b / 22.5) % 16];

  // Points along the great circle, for drawing guess -> answer lines.
  function greatCircle(a, b, n = 64) {
    const d = distKm(a, b) / R;
    if (d < 1e-6) return [[a.lon, a.lat], [b.lon, b.lat]];
    const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
    const pts = [];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      let lon = deg(Math.atan2(y, x));
      // keep longitudes continuous so the line doesn't wrap the wrong way
      if (prev !== null) while (lon - prev > 180) lon -= 360;
      if (prev !== null) while (prev - lon > 180) lon += 360;
      prev = lon;
      pts.push([lon, deg(Math.atan2(z, Math.hypot(x, y)))]);
    }
    return pts;
  }

  // maptap's points vs. miss distance fits 100 * exp(-km / 4600) closely
  // (e.g. 176 km -> 96, 658 km -> 87, 1773 km -> 68).
  const K = 4600;
  const scoreFor = km => Math.round(100 * Math.exp(-km / K));
  const kmFor = score => score >= 100 ? 10 : -K * Math.log(Math.max(score, 1) / 100);

  function fmtKm(km) {
    return km < 10 ? km.toFixed(1) + ' km' : Math.round(km).toLocaleString() + ' km';
  }
  function fmtPop(p) {
    if (!p) return '';
    if (p >= 1e6) return (p / 1e6).toFixed(p >= 1e7 ? 0 : 1) + 'M';
    if (p >= 1e3) return Math.round(p / 1e3) + 'k';
    return String(p);
  }
  function fmtLatLon(lat, lon) {
    return Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W');
  }

  function norm(s) {
    return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[’ʻ`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- polygons ----------------------------------------------------------
  function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polyContains(poly, x, y) {
    if (!ringContains(poly[0], x, y)) return false;
    for (let i = 1; i < poly.length; i++) if (ringContains(poly[i], x, y)) return false;
    return true;
  }
  function polys(geom) {
    return geom.type === 'Polygon' ? [geom.coordinates] :
      geom.type === 'MultiPolygon' ? geom.coordinates : [];
  }
  function bboxOf(geom) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polys(geom)) for (const [x, y] of p[0]) {
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
    return b;
  }
  function indexPolys(fc) {
    return fc.features.map(f => ({ f, bbox: bboxOf(f.geometry), polys: polys(f.geometry) }));
  }
  function findIn(index, lon, lat) {
    for (const e of index) {
      const b = e.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      for (const p of e.polys) if (polyContains(p, lon, lat)) return e.f;
    }
    return null;
  }
  // Rough distance (km) from a point to the nearest vertex of a feature.
  function nearestVertexKm(e, pt) {
    let best = Infinity;
    for (const p of e.polys) for (const [x, y] of p[0]) {
      const d = distKm(pt, { lat: y, lon: x });
      if (d < best) best = d;
    }
    return best;
  }

  // ---- city table -------------------------------------------------------
  const C = MT.cities;
  const countries = C.countries;              // iso -> [name, continent]
  const stateCountries = new Set(C.stateCountries);
  const cities = C.rows.map((r, i) => ({
    i, name: r[0], lat: r[1], lon: r[2], pop: r[3], cc: r[4],
    a1: C.admin1[r[5]], flag: r[6], likely: r[7],
  }));
  const countryName = cc => (countries[cc] || [cc])[0];
  const continentOf = cc => (countries[cc] || [, ''])[1];

  // maptap-style label: "City, State, Country" for the big federal countries.
  function cityLabel(c) {
    if (c.cc === 'GB') return `${c.name}, ${c.a1}, UK`;
    if (stateCountries.has(c.cc) && c.a1) return `${c.name}, ${c.a1}, ${countryName(c.cc)}`;
    return `${c.name}, ${countryName(c.cc)}`;
  }

  const countryIndex = indexPolys(MT.countries);
  const stateIndex = indexPolys(MT.admin1);
  const regionIndex = indexPolys(MT.physical.regions);

  const countryAt = (lon, lat) => findIn(countryIndex, lon, lat);
  const stateAt = (lon, lat) => findIn(stateIndex, lon, lat);

  // Spatial grid over cities for fast nearest-neighbour lookups.
  const GRID = 2;
  const grid = new Map();
  for (const c of cities) {
    const k = Math.floor(c.lat / GRID) + ':' + Math.floor(c.lon / GRID);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  function citiesNear(pt, radiusKm) {
    const span = Math.ceil(radiusKm / 111 / GRID) + 1;
    const out = [];
    const gy = Math.floor(pt.lat / GRID), gx = Math.floor(pt.lon / GRID);
    const lonSpan = Math.min(180 / GRID, Math.ceil(span / Math.max(0.1, Math.cos(rad(pt.lat)))));
    for (let dy = -span; dy <= span; dy++) for (let dx = -lonSpan; dx <= lonSpan; dx++) {
      let x = gx + dx;
      const n = 360 / GRID;
      x = ((x + n / 2) % n + n) % n - n / 2;
      const cell = grid.get((gy + dy) + ':' + x);
      if (!cell) continue;
      for (const c of cell) {
        const d = distKm(pt, c);
        if (d <= radiusKm) out.push({ c, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  const capitals = {};
  for (const c of cities) if (c.flag === 2 && !capitals[c.cc]) capitals[c.cc] = c;

  // Look up a city by maptap-style label ("Name, [State,] Country").
  const byName = new Map();
  for (const c of cities) {
    const k = norm(c.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
  const countryByName = new Map();
  for (const [iso, [name]] of Object.entries(countries)) countryByName.set(norm(name), iso);
  for (const [k, v] of Object.entries({
    usa: 'US', 'united states': 'US', uk: 'GB', 'united kingdom': 'GB', england: 'GB',
    scotland: 'GB', wales: 'GB', 'northern ireland': 'GB', 'georgia country': 'GE',
    'czech republic': 'CZ', turkey: 'TR', netherlands: 'NL', 'the netherlands': 'NL',
  })) countryByName.set(k, v);

  const seenByLabel = new Map((MT.seen || []).map(r =>
    [r[0], { label: r[0], lat: r[1], lon: r[2], cc: r[3], pop: r[4] }]));

  function geocode(label) {
    if (seenByLabel.has(label)) return seenByLabel.get(label);
    const parts = label.split(',').map(s => s.trim());
    const cc = countryByName.get(norm(parts[parts.length - 1]));
    const cands = (byName.get(norm(parts[0])) || []).filter(c => !cc || c.cc === cc);
    if (!cands.length) return null;
    const state = parts.length === 3 ? norm(parts[1]) : null;
    const best = (state && cands.find(c => norm(c.a1).includes(state))) || cands[0];
    return { label, lat: best.lat, lon: best.lon, cc: best.cc, pop: best.pop, city: best };
  }

  return {
    distKm, bearing, compass, greatCircle, scoreFor, kmFor, fmtKm, fmtPop, fmtLatLon, norm,
    cities, countries, countryName, continentOf, cityLabel, stateCountries, capitals,
    countryAt, stateAt, citiesNear, geocode, seenByLabel,
    regionIndex, findIn, nearestVertexKm, countryIndex, stateIndex, bboxOf,
  };
})();
