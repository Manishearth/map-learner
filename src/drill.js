// Quick drills on the part of the world currently in view.
'use strict';

const Drill = (() => {
  const $ = id => document.getElementById(id);
  const map = () => Layers.map;
  let d = null;   // {kind, items, target, right, total, snap, answered}

  function inView(lon, lat) {
    const m = map();
    const c = m.getCenter();
    if (Geo.distKm({ lat: c.lat, lon: c.lng }, { lat, lon }) > 7000) return false;
    const p = m.project([lon, lat]);
    const cv = m.getCanvas();
    const w = cv.clientWidth, h = cv.clientHeight;
    const panelW = document.getElementById('panel').classList.contains('collapsed') ? 0 : 340;
    return p.x > panelW + 10 && p.x < w - 10 && p.y > 70 && p.y < h - 10;
  }

  function citiesInView(n) {
    const out = [];
    for (const c of Geo.cities) {   // already sorted by population
      if (inView(c.lon, c.lat)) out.push(c);
      if (out.length >= n) break;
    }
    return out;
  }

  function start(kind) {
    stop();
    Practice.stop();
    d = { kind, right: 0, total: 0, snap: Layers.snapshot(), asked: new Set() };
    if (kind === 'findCity' || kind === 'nameCity') {
      d.items = citiesInView(+$('drillCount').value);
      if (d.items.length < 4) { UI.toast('Zoom out a bit: fewer than 4 cities in view.'); stop(); return; }
      Layers.only(['borders', 'states']);
    } else if (kind === 'country') {
      d.items = MT.countries.features.filter(f => inView(f.properties.lx, f.properties.ly));
      Layers.only([]);
    } else {
      d.items = MT.admin1.features.filter(f => inView(f.properties.lx, f.properties.ly));
      Layers.only(['borders']);
    }
    if (d.items.length < 2) { UI.toast('Nothing to drill in this view.'); stop(); return; }
    next();
  }

  function stop() {
    if (!d) return;
    Layers.setData('drill', null);
    Layers.clearHighlights();
    Layers.restore(d.snap);
    $('banner').hidden = true;
    d = null;
    $('drillOut').innerHTML = '';
  }

  const nameOf = it => it.properties ? it.properties.name : it.name;

  function chooseTarget() {
    let pool = d.items.filter(it => !d.asked.has(nameOf(it)));
    if (!pool.length) { d.asked.clear(); pool = d.items; }
    const t = pool[Math.floor(Math.random() * pool.length)];
    d.asked.add(nameOf(t));
    return t;
  }

  function cityDots(states = {}, labels = {}) {
    Layers.setData('drill', { type: 'FeatureCollection', features: d.items.map(c => {
      const props = { i: c.i, state: states[c.i] || '', hl: states[c.i] === 'target' ? 1 : 0 };
      if (labels[c.i]) props.label = labels[c.i];
      return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } };
    }) });
  }

  function banner(prompt, sub) {
    $('banner').innerHTML = `<div class="prompt">${prompt}</div>
      <div class="sub"><span>${d.right}/${d.total} right</span>${sub || ''}<button id="dStop">Stop</button></div>`;
    $('banner').hidden = false;
    $('dStop').onclick = stop;
  }

  function next() {
    d.answered = false;
    d.target = chooseTarget();
    Layers.clearHighlights();
    $('drillOut').innerHTML = '';
    const t = d.target;
    if (d.kind === 'findCity') {
      cityDots();
      const a1 = Geo.stateCountries.has(t.cc) ? t.a1 + ', ' : '';
      banner(`Click: ${t.name}`, `<span>${a1}${Geo.countryName(t.cc)}</span>`);
    } else if (d.kind === 'nameCity') {
      cityDots({ [t.i]: 'target' });
      // Distractors: the closest other cities, which are the confusable ones.
      const others = d.items.filter(c => c !== t)
        .sort((a, b) => Geo.distKm(a, t) - Geo.distKm(b, t)).slice(0, 6);
      const opts = shuffle([t, ...shuffle(others).slice(0, 3)]);
      banner('Which city is the yellow dot?');
      $('drillOut').innerHTML = `<div class="choices">${opts.map(c =>
        `<button data-i="${c.i}">${c.name}<small> ${Geo.fmtPop(c.pop)}</small></button>`).join('')}</div>`;
      for (const b of $('drillOut').querySelectorAll('button')) b.onclick = () => answerName(b, opts);
    } else {
      const p = t.properties;
      banner(`Click: ${p.name}`, d.kind === 'state' ? `<span>${Geo.countryName(p.iso)}</span>` : '');
    }
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function answerName(btn, opts) {
    if (d.answered) { next(); return; }
    d.answered = true;
    d.total++;
    const t = d.target;
    const ok = +btn.dataset.i === t.i;
    if (ok) d.right++;
    for (const b of $('drillOut').querySelectorAll('button')) {
      if (+b.dataset.i === t.i) b.classList.add('right');
      else if (b === btn) b.classList.add('wrong');
    }
    const labels = {};
    for (const c of opts) labels[c.i] = c.name;
    cityDots({ [t.i]: ok ? 'right' : 'target' }, labels);
    banner(ok ? 'Right!' : `That's ${t.name}`, '<span>Enter / click for next</span>');
    if (ok) setTimeout(() => { if (d && d.answered && d.target === t) next(); }, 900);
  }

  function onMapClick(e) {
    if (!d) return false;
    if (d.answered) { next(); return true; }
    const t = d.target;
    if (d.kind === 'findCity') {
      const pt = e.point;
      const hits = map().queryRenderedFeatures([[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 12]], { layers: ['drill-dot'] });
      if (!hits.length) return true;
      const ci = hits[0].properties.i;
      d.answered = true; d.total++;
      const clicked = Geo.cities[ci];
      if (ci === t.i) {
        d.right++;
        cityDots({ [t.i]: 'right' }, { [t.i]: t.name });
        banner('Right!', '');
        setTimeout(() => { if (d && d.target === t) next(); }, 800);
      } else {
        cityDots({ [t.i]: 'target', [ci]: 'wrong' }, { [t.i]: t.name, [ci]: clicked.name });
        banner(`No — that's ${clicked.name}`, `<span>${Geo.fmtKm(Geo.distKm(clicked, t))} from ${t.name} · click for next</span>`);
      }
      return true;
    }
    const p = t.properties;
    const hit = d.kind === 'country' ? Geo.countryAt(e.lngLat.lng, e.lngLat.lat)
      : Geo.stateAt(e.lngLat.lng, e.lngLat.lat);
    d.answered = true; d.total++;
    const ok = hit && hit.properties.name === p.name && hit.properties.iso === p.iso;
    if (d.kind === 'country') Layers.highlightCountry(p.iso);
    else Layers.highlightState(p.iso, p.name);
    if (ok) {
      d.right++;
      banner(`Right: ${p.name}`, '');
      setTimeout(() => { if (d && d.target === t) next(); }, 900);
    } else {
      if (hit && d.kind === 'country') Layers.highlightCountry(hit.properties.iso, 'wrong');
      banner(`No — you clicked ${hit ? hit.properties.name : 'the sea'}`,
        `<span>${p.name} is highlighted · click for next</span>`);
    }
    return true;
  }

  function onKey(e) {
    if (!d) return false;
    if ((e.key === 'Enter' || e.key === ' ') && d.answered) { next(); return true; }
    if (e.key === 'Escape') { stop(); return true; }
    return false;
  }

  return { start, stop, onMapClick, onKey, get active() { return !!d; } };
})();
