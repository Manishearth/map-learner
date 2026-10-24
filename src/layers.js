// Map construction and the overlay layers the Explore tab toggles.
'use strict';

const Layers = (() => {
  const FONT = ['Open Sans Regular'];
  const FONT_B = ['Open Sans Bold'];
  const FONT_I = ['Open Sans Italic'];
  const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
  const OCEAN = '#0c2160';

  let map;
  // Which layers each overlay toggle controls.
  const GROUPS = {
    ocean: ['ocean-fill'],
    graticule: ['grat-line', 'grat-major', 'grat-label'],
    borders: ['country-line'],
    countryLabels: ['country-label', 'country-label-minor'],
    states: ['state-line'],
    stateLabels: ['state-label'],
    cities: ['city-dot'],
    cityLabels: ['city-label'],
    seenCities: ['seen-dot'],
    heatmap: ['heat'],
    ranges: ['range-fill', 'range-line', 'range-label'],
    deserts: ['other-fill', 'other-label'],
    peaks: ['peak-label'],
    rivers: ['river-line', 'river-label', 'lake-label'],
    seas: ['sea-label'],
  };
  const state = {};   // overlay name -> bool
  let cityCount = 400, capitalsOnly = false;

  function pointsFrom(fc, extra) {
    return {
      type: 'FeatureCollection',
      features: fc.features.map(f => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [f.properties.lx, f.properties.ly] },
        properties: Object.assign({}, f.properties, extra),
      })),
    };
  }

  function citiesFC() {
    return {
      type: 'FeatureCollection',
      features: Geo.cities.map(c => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { r: c.i, n: c.name, p: c.pop, f: c.flag },
      })),
    };
  }

  function graticuleFC() {
    const feats = [];
    const line = (coords, props) => feats.push({ type: 'Feature', properties: props,
      geometry: { type: 'LineString', coordinates: coords } });
    for (let lon = -180; lon < 180; lon += 10) {
      const c = [];
      for (let lat = -85; lat <= 85; lat += 5) c.push([lon, lat]);
      line(c, { major: lon === 0 ? 1 : 0, name: lon === 0 ? 'Prime meridian' : '' });
    }
    const named = { 0: 'Equator', 23.44: 'Tropic of Cancer', '-23.44': 'Tropic of Capricorn',
      66.56: 'Arctic Circle', '-66.56': 'Antarctic Circle' };
    const lats = [];
    for (let lat = -80; lat <= 80; lat += 10) lats.push(lat);
    lats.push(23.44, -23.44, 66.56, -66.56);
    for (const lat of lats) {
      const c = [];
      for (let lon = -180; lon <= 180; lon += 5) c.push([lon, lat]);
      const name = named[lat] || '';
      line(c, { major: name ? 1 : 0, name: name || (lat + '°') });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  const EMPTY = { type: 'FeatureCollection', features: [] };

  function style() {
    const ph = MT.physical;
    const raster = (tiles, maxzoom, attribution) =>
      ({ type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution });
    return {
      version: 8,
      projection: { type: 'globe' },
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
      sources: {
        bm: raster(GIBS + 'BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
          8, 'Imagery: NASA Blue Marble (GIBS)'),
        relief: raster(GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
          8, 'Imagery: NASA Blue Marble (GIBS)'),
        esri: raster('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          19, 'Imagery: Esri, Maxar, Earthstar Geographics'),
        ocean: { type: 'geojson', data: MT.ocean },
        countries: { type: 'geojson', data: MT.countries,
          attribution: 'Natural Earth; cities: GeoNames (CC-BY)' },
        countryPts: { type: 'geojson', data: pointsFrom(MT.countries) },
        states: { type: 'geojson', data: MT.admin1 },
        statePts: { type: 'geojson', data: pointsFrom(MT.admin1) },
        cities: { type: 'geojson', data: citiesFC() },
        seen: { type: 'geojson', data: {
          type: 'FeatureCollection', features: (MT.seen || []).map(r => ({ type: 'Feature',
            geometry: { type: 'Point', coordinates: [r[2], r[1]] }, properties: { n: r[0] } })) } },
        regions: { type: 'geojson', data: ph.regions },
        peaks: { type: 'geojson', data: ph.peaks },
        rivers: { type: 'geojson', data: ph.rivers },
        lakes: { type: 'geojson', data: ph.lakes },
        seas: { type: 'geojson', data: ph.seas },
        grat: { type: 'geojson', data: graticuleFC() },
        stats: { type: 'geojson', data: EMPTY },
        game: { type: 'geojson', data: EMPTY },
        drill: { type: 'geojson', data: EMPTY },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': OCEAN } },
        { id: 'base-bm', type: 'raster', source: 'bm' },
        { id: 'base-relief', type: 'raster', source: 'relief', layout: { visibility: 'none' } },
        { id: 'base-esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
        { id: 'ocean-fill', type: 'fill', source: 'ocean',
          paint: { 'fill-color': OCEAN, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 1, 9, 0.6] } },
        { id: 'heat', type: 'heatmap', source: 'cities', layout: { visibility: 'none' },
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'p'], 15000, 0.02, 200000, 0.15, 2000000, 0.6, 20000000, 1],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 4, 14, 8, 30],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 1.2],
            'heatmap-opacity': 0.75,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)', 0.15, 'rgba(80,0,120,0.5)', 0.4, 'rgb(200,30,90)',
              0.7, 'rgb(255,140,0)', 1, 'rgb(255,255,150)'],
          } },
        { id: 'range-fill', type: 'fill', source: 'regions', filter: ['==', ['get', 'kind'], 'range'],
          paint: { 'fill-color': '#d9772b', 'fill-opacity': 0.18 } },
        { id: 'range-line', type: 'line', source: 'regions', filter: ['==', ['get', 'kind'], 'range'],
          paint: { 'line-color': '#f0a060', 'line-width': 0.8, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } },
        { id: 'other-fill', type: 'fill', source: 'regions', layout: { visibility: 'none' },
          filter: ['match', ['get', 'kind'], ['desert', 'plateau', 'basin', 'plain', 'delta', 'valley'], true, false],
          paint: { 'fill-color': ['match', ['get', 'kind'], 'desert', '#f0d070', 'plateau', '#c090f0', '#70d0f0'],
            'fill-opacity': 0.14 } },
        { id: 'river-line', type: 'line', source: 'rivers',
          paint: { 'line-color': '#7fd4ff', 'line-opacity': 0.8,
            'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['-', 2.2, ['*', 0.2, ['get', 'rank']]], 6, 2.5] } },
        { id: 'grat-line', type: 'line', source: 'grat', layout: { visibility: 'none' },
          filter: ['==', ['get', 'major'], 0],
          paint: { 'line-color': '#ffffff', 'line-opacity': 0.18, 'line-width': 0.7 } },
        { id: 'grat-major', type: 'line', source: 'grat', layout: { visibility: 'none' },
          filter: ['==', ['get', 'major'], 1],
          paint: { 'line-color': '#ffe08a', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [4, 3] } },
        { id: 'state-line', type: 'line', source: 'states',
          paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
        { id: 'hl-state-fill', type: 'fill', source: 'states', filter: ['==', ['get', 'name'], '\u0000'],
          paint: { 'fill-color': '#40c0ff', 'fill-opacity': 0.25 } },
        { id: 'hl-state-line', type: 'line', source: 'states', filter: ['==', ['get', 'name'], '\u0000'],
          paint: { 'line-color': '#40c0ff', 'line-width': 2 } },
        { id: 'country-line', type: 'line', source: 'countries',
          paint: { 'line-color': '#ffd84a', 'line-opacity': 0.85,
            'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 6, 1.8] } },
        { id: 'hl-country-fill', type: 'fill', source: 'countries', filter: ['==', ['get', 'iso'], '\u0000'],
          paint: { 'fill-color': '#ffd84a', 'fill-opacity': 0.18 } },
        { id: 'hl-country-line', type: 'line', source: 'countries', filter: ['==', ['get', 'iso'], '\u0000'],
          paint: { 'line-color': '#ffd84a', 'line-width': 3 } },
        { id: 'hl-wrong-fill', type: 'fill', source: 'countries', filter: ['==', ['get', 'iso'], '\u0000'],
          paint: { 'fill-color': '#ff5050', 'fill-opacity': 0.18 } },
        { id: 'game-line', type: 'line', source: 'game', filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
        { id: 'game-area', type: 'fill', source: 'game', filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#ffcc33', 'fill-opacity': 0.15 } },
        { id: 'stats-dot', type: 'circle', source: 'stats', layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 6, 7],
            'circle-color': ['interpolate', ['linear'], ['get', 'avg'], 40, '#d7191c', 75, '#fdae61', 90, '#ffffbf', 97, '#1a9641'],
            'circle-stroke-color': '#000', 'circle-stroke-width': 1,
          } },
        { id: 'seen-dot', type: 'circle', source: 'seen', layout: { visibility: 'none' },
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 6, 5],
            'circle-color': '#ff7ad9', 'circle-stroke-color': '#000', 'circle-stroke-width': 0.8 } },
        { id: 'city-dot', type: 'circle', source: 'cities',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              1, ['interpolate', ['linear'], ['get', 'p'], 0, 1.5, 1e6, 2.5, 1e7, 4],
              8, ['interpolate', ['linear'], ['get', 'p'], 0, 3.5, 1e6, 6, 1e7, 8]],
            'circle-color': ['match', ['get', 'f'], 2, '#ff4040', 1, '#ffa040', '#ffffff'],
            'circle-stroke-color': '#000', 'circle-stroke-width': 1,
          } },
        { id: 'drill-dot', type: 'circle', source: 'drill',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'hl'], 1], 10, 6],
            'circle-color': ['match', ['get', 'state'], 'right', '#3ddc84', 'wrong', '#ff4d4d', 'target', '#ffcc33', '#ffffff'],
            'circle-stroke-color': '#000', 'circle-stroke-width': 1.5,
          } },
        { id: 'drill-label', type: 'symbol', source: 'drill', filter: ['has', 'label'],
          layout: { 'text-field': ['get', 'label'], 'text-font': FONT_B, 'text-size': 13,
            'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true },
          paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.5 } },
        { id: 'range-label', type: 'symbol', source: 'regions', filter: ['==', ['get', 'kind'], 'range'],
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT_I, 'text-size': 12,
            'text-transform': 'uppercase', 'text-letter-spacing': 0.15, 'symbol-sort-key': ['get', 'rank'] },
          paint: { 'text-color': '#ffc590', 'text-halo-color': '#3a1d00', 'text-halo-width': 1.2 } },
        { id: 'other-label', type: 'symbol', source: 'regions', layout: { visibility: 'none',
          'text-field': ['get', 'name'], 'text-font': FONT_I, 'text-size': 12, 'symbol-sort-key': ['get', 'rank'] },
          filter: ['match', ['get', 'kind'], ['desert', 'plateau', 'basin', 'plain', 'delta', 'valley', 'peninsula'], true, false],
          paint: { 'text-color': '#ffeeaa', 'text-halo-color': '#000', 'text-halo-width': 1.2 } },
        { id: 'river-label', type: 'symbol', source: 'rivers', filter: ['!=', ['get', 'name'], ''],
          layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT_I,
            'text-size': 11, 'symbol-spacing': 400 },
          paint: { 'text-color': '#bfeaff', 'text-halo-color': '#002040', 'text-halo-width': 1.2 } },
        { id: 'lake-label', type: 'symbol', source: 'lakes', filter: ['all', ['!=', ['get', 'name'], ''], ['<=', ['get', 'rank'], 4]],
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT_I, 'text-size': 11 },
          paint: { 'text-color': '#bfeaff', 'text-halo-color': '#002040', 'text-halo-width': 1.2 } },
        { id: 'sea-label', type: 'symbol', source: 'seas', layout: { visibility: 'none',
          'text-field': ['get', 'name'], 'text-font': FONT_I, 'text-size': 12, 'symbol-sort-key': ['get', 'rank'] },
          paint: { 'text-color': '#9fc8ff', 'text-halo-color': '#001030', 'text-halo-width': 1 } },
        { id: 'peak-label', type: 'symbol', source: 'peaks', layout: { visibility: 'none',
          'text-field': ['concat', '▲ ', ['get', 'name']], 'text-font': FONT, 'text-size': 11,
          'symbol-sort-key': ['get', 'rank'] },
          paint: { 'text-color': '#ffd0a0', 'text-halo-color': '#000', 'text-halo-width': 1.2 } },
        { id: 'grat-label', type: 'symbol', source: 'grat', layout: { visibility: 'none',
          'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10,
          'symbol-spacing': 600 },
          paint: { 'text-color': '#ffe08a', 'text-halo-color': '#000', 'text-halo-width': 1 } },
        { id: 'state-label', type: 'symbol', source: 'statePts',
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size':
            ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 13], 'text-transform': 'uppercase',
            'text-letter-spacing': 0.05, 'text-max-width': 7 },
          minzoom: 2.2,
          paint: { 'text-color': '#cfeaff', 'text-halo-color': '#000', 'text-halo-width': 1.2, 'text-opacity': 0.9 } },
        { id: 'city-label', type: 'symbol', source: 'cities',
          layout: { 'text-field': ['get', 'n'], 'text-font': FONT, 'symbol-sort-key': ['get', 'r'],
            'text-size': ['interpolate', ['linear'], ['get', 'p'], 0, 11, 1e6, 13, 1e7, 15],
            'text-anchor': 'left', 'text-offset': [0.5, 0], 'text-optional': false },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#000', 'text-halo-width': 1.4 } },
        { id: 'country-label-minor', type: 'symbol', source: 'countryPts', minzoom: 3.2,
          filter: ['>', ['get', 'rank'], 4],
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT_B, 'text-size': 13, 'text-max-width': 8 },
          paint: { 'text-color': '#ffe9a0', 'text-halo-color': '#000', 'text-halo-width': 1.6 } },
        { id: 'country-label', type: 'symbol', source: 'countryPts', filter: ['<=', ['get', 'rank'], 4],
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT_B, 'symbol-sort-key': ['get', 'rank'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['max', 10, ['-', 15, ['get', 'rank']]], 5, 16],
            'text-max-width': 8 },
          paint: { 'text-color': '#ffe9a0', 'text-halo-color': '#000', 'text-halo-width': 1.6 } },
      ],
    };
  }

  function init(container) {
    // Start every GeoJSON source empty and fill it once the style is up: passing
    // ~10 MB of GeoJSON inside the style makes MapLibre validate/clone it all first.
    const st = style();
    const initial = {};
    for (const [id, src] of Object.entries(st.sources)) {
      if (src.type === 'geojson' && src.data !== EMPTY) { initial[id] = src.data; src.data = EMPTY; }
    }
    map = new maplibregl.Map({
      container, style: st, center: [-40, 25], zoom: 1.6, validateStyle: false,
      maxPitch: 0, attributionControl: { compact: true }, doubleClickZoom: false,
    });
    map.once('styledata', () => {
      for (const [id, data] of Object.entries(initial)) map.getSource(id).setData(data);
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.setPadding({ left: 340, top: 0, right: 0, bottom: 0 });
    return map;
  }

  function vis(id, on) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  function set(name, on) {
    state[name] = on;
    for (const id of GROUPS[name] || []) vis(id, on);
    if (name === 'cities' || name === 'cityLabels') applyCityFilter();
  }

  function setBasemap(which) {
    for (const b of ['bm', 'relief', 'esri']) vis('base-' + b, b === which);
  }

  function applyCityFilter() {
    const f = ['all', ['<', ['get', 'r'], cityCount]];
    if (capitalsOnly) f.push(['>', ['get', 'f'], 0]);
    map.setFilter('city-dot', f);
    map.setFilter('city-label', f);
    const any = cityCount > 0;
    vis('city-dot', any && state.cities !== false);
    vis('city-label', any && state.cities !== false && state.cityLabels !== false);
  }
  function setCityCount(n) { cityCount = n; applyCityFilter(); }
  function setCapitalsOnly(on) { capitalsOnly = on; applyCityFilter(); }

  // Save / restore overlay visibility (practice mode hides everything while guessing).
  function snapshot() { return Object.assign({}, state); }
  function restore(snap) { for (const [k, v] of Object.entries(snap)) set(k, v); }
  function only(names) {
    for (const k of Object.keys(GROUPS)) set(k, k === 'ocean' ? state.ocean : names.includes(k));
  }

  function highlightCountry(iso, layer = 'country') {
    const f = ['==', ['get', 'iso'], iso || '\u0000'];
    if (layer === 'wrong') { map.setFilter('hl-wrong-fill', f); return; }
    map.setFilter('hl-country-fill', f);
    map.setFilter('hl-country-line', f);
  }
  function highlightState(iso, name) {
    const f = name ? ['all', ['==', ['get', 'iso'], iso], ['==', ['get', 'name'], name]]
      : ['==', ['get', 'name'], '\u0000'];
    map.setFilter('hl-state-fill', f);
    map.setFilter('hl-state-line', f);
  }
  function clearHighlights() {
    highlightCountry(null); highlightCountry(null, 'wrong'); highlightState(null, null);
  }

  function setData(source, data) {
    const src = map.getSource(source);
    if (src) src.setData(data || EMPTY);
    else map.once('styledata', () => setData(source, data));   // style still loading
  }

  function circlePolygon(center, km, n = 64) {
    const coords = [];
    for (let i = 0; i <= n; i++) {
      const brg = i / n * 2 * Math.PI, d = km / 6371;
      const la1 = center.lat * Math.PI / 180, lo1 = center.lon * Math.PI / 180;
      const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
      const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
      coords.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
  }

  return { init, set, setBasemap, setCityCount, setCapitalsOnly, snapshot, restore, only,
    highlightCountry, highlightState, clearHighlights, setData, circlePolygon, vis,
    get map() { return map; }, get state() { return state; } };
})();
