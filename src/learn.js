// "Learning card" facts about a location: where it sits relative to borders,
// big cities, capitals, mountains, rivers and the coast.
'use strict';

const Learn = (() => {
  const ranges = Geo.regionIndex.filter(e => e.f.properties.kind === 'range');
  const areas = Geo.regionIndex.filter(e =>
    ['desert', 'plateau', 'basin', 'plain', 'delta', 'valley', 'peninsula'].includes(e.f.properties.kind));

  // Flatten rivers and coastline into segment lists for distance checks.
  function segmentsOf(fc) {
    const segs = [];
    for (const f of fc.features) {
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] :
        g.type === 'MultiLineString' ? g.coordinates :
        g.type === 'Polygon' ? g.coordinates :
        g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
      for (const l of lines) for (let i = 1; i < l.length; i++)
        segs.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1], f.properties.name || '']);
    }
    return segs;
  }
  const riverSegs = segmentsOf(MT.physical.rivers);
  const coastSegs = segmentsOf(MT.ocean);

  // Approximate point-to-segment distance in km using a local flat projection.
  function segDistKm(pt, s) {
    const kx = 111.32 * Math.cos(pt.lat * Math.PI / 180), ky = 110.57;
    const ax = (s[0] - pt.lon) * kx, ay = (s[1] - pt.lat) * ky;
    const bx = (s[2] - pt.lon) * kx, by = (s[3] - pt.lat) * ky;
    const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
    const t = dd ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / dd)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  function nearestSeg(pt, segs, maxDeg) {
    let best = Infinity, name = '';
    for (const s of segs) {
      if (Math.abs(s[1] - pt.lat) > maxDeg && Math.abs(s[3] - pt.lat) > maxDeg) continue;
      if (Math.abs(s[0] - pt.lon) > maxDeg * 3 && Math.abs(s[2] - pt.lon) > maxDeg * 3) continue;
      const d = segDistKm(pt, s);
      if (d < best) { best = d; name = s[4]; }
    }
    return { km: best, name };
  }

  function rel(pt, c) {
    const d = Geo.distKm(c, pt);
    return `${Geo.fmtKm(d)} ${Geo.compass(Geo.bearing(c, pt))} of`;
  }

  // Returns {country, state, facts: [html strings]} for a point.
  function about(pt, opts = {}) {
    const facts = [];
    const cf = Geo.countryAt(pt.lon, pt.lat);
    const cc = opts.cc || (cf && cf.properties.iso);
    const sf = Geo.stateAt(pt.lon, pt.lat);
    let pop = opts.pop || 0;
    const country = cc ? Geo.countryName(cc) : (cf ? cf.properties.name : null);
    const stateName = sf && sf.properties.iso === cc ? sf.properties.name : null;

    // Nearest well-known city (much bigger than this place).
    const cap = cc && Geo.capitals[cc];
    const near = Geo.citiesNear(pt, 900);
    const self = near.find(x => x.d < 8 && (!opts.name || Geo.norm(x.c.name) === Geo.norm(opts.name)));
    if (!pop && self) pop = self.c.pop;
    // Prefer a big city in the same country; fall back to any big neighbour.
    const threshold = Math.max(500000, pop * 1.5);
    const bigOk = x => x.c.pop >= threshold && x.d > 8 && (!cap || x.c !== cap);
    const big = near.find(x => bigOk(x) && x.c.cc === cc && x.d < 600) || near.find(bigOk);
    if (big) facts.push(`${rel(pt, big.c)} <b>${big.c.name}</b> (${Geo.fmtPop(big.c.pop)}${big.c.cc !== cc ? ', ' + Geo.countryName(big.c.cc) : ''})`);
    const mid = near.find(x => x.c.pop >= 150000 && x.d > 8 && x.d < 150 && (!big || x.c !== big.c));
    if (mid && (!big || mid.d < big.d * 0.6)) facts.push(`${rel(pt, mid.c)} ${mid.c.name} (${Geo.fmtPop(mid.c.pop)})`);

    if (cap && Geo.distKm(cap, pt) > 15) facts.push(`${rel(pt, cap)} the capital, ${cap.name}`);
    else if (cap) facts.push(`National capital of ${country}`);

    // Terrain context.
    const inRange = Geo.findIn(ranges, pt.lon, pt.lat);
    if (inRange) facts.push(`In the <b>${inRange.properties.name}</b> (mountains)`);
    else {
      let best = null;
      for (const e of ranges) {
        const b = e.bbox;
        if (pt.lon < b[0] - 5 || pt.lon > b[2] + 5 || pt.lat < b[1] - 4 || pt.lat > b[3] + 4) continue;
        const d = Geo.nearestVertexKm(e, pt);
        if (d < 300 && (!best || d < best.d)) best = { d, e };
      }
      if (best) {
        const ctr = { lon: (best.e.bbox[0] + best.e.bbox[2]) / 2, lat: (best.e.bbox[1] + best.e.bbox[3]) / 2 };
        facts.push(`~${Geo.fmtKm(best.d)} from the ${best.e.f.properties.name} (mountains to the ${Geo.compass(Geo.bearing(pt, ctr))})`);
      }
    }
    const area = Geo.findIn(areas, pt.lon, pt.lat);
    if (area) facts.push(`In the ${area.properties.name} (${area.properties.kind})`);

    const river = nearestSeg(pt, riverSegs, 1);
    if (river.km < 25 && river.name) facts.push(`On or near the <b>${river.name}</b> river`);
    const coast = nearestSeg(pt, coastSegs, 6);
    if (coast.km < 12) facts.push('On the coast');
    else if (coast.km < 2000) facts.push(`Inland, ~${Geo.fmtKm(coast.km)} from the sea`);

    facts.push(`${Geo.fmtLatLon(pt.lat, pt.lon)}${self && self.c.pop ? ' · pop ' + Geo.fmtPop(self.c.pop) : (pop ? ' · pop ' + Geo.fmtPop(pop) : '')}`);
    return { cc, country, state: stateName, facts };
  }

  return { about };
})();
