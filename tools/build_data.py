#!/usr/bin/env python3
"""Build the static data files in app/data/ from raw downloads.

Raw inputs live outside the repo (default: ../../data-raw relative to this
file). See README.md for the download list. Run with Python 3:

    python tools/build_data.py [RAW_DIR] [SCORES_DIR]

SCORES_DIR (optional) holds maptap CSV exports; every location name found in
them is geocoded and written to data/seen.js so practice mode can include
the kinds of places maptap actually asks about.
"""
import csv
import glob
import json
import math
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(APP, '..', 'data-raw')
SCORES = sys.argv[2] if len(sys.argv) > 2 else os.path.join(APP, '..', 'scores')
OUT = os.path.join(APP, 'data')

# Countries maptap labels as "City, State, Country".
STATE_COUNTRIES = ['US', 'CN', 'BR', 'IN', 'RU', 'CL', 'AU', 'ID', 'MX', 'AR', 'CA']

# Display names, matching maptap's spelling where we've seen it.
COUNTRY_DISPLAY = {
    'US': 'USA', 'GB': 'United Kingdom', 'TR': 'Türkiye', 'CZ': 'Czechia',
    'CD': 'Democratic Republic of the Congo', 'CG': 'Republic of the Congo',
    'CI': "Côte d'Ivoire", 'KR': 'South Korea', 'KP': 'North Korea',
    'LA': 'Laos', 'MK': 'North Macedonia', 'PS': 'Palestine', 'SZ': 'Eswatini',
    'TL': 'Timor-Leste', 'GM': 'The Gambia', 'CV': 'Cape Verde',
    'FM': 'Micronesia', 'VA': 'Vatican City', 'RU': 'Russia', 'IR': 'Iran',
    'SY': 'Syria', 'VN': 'Vietnam', 'BO': 'Bolivia', 'VE': 'Venezuela',
    'TZ': 'Tanzania', 'MD': 'Moldova', 'BN': 'Brunei', 'MM': 'Myanmar',
    'ST': 'São Tomé and Príncipe', 'BS': 'Bahamas', 'XK': 'Kosovo',
    'MO': 'Macau', 'HK': 'Hong Kong', 'TW': 'Taiwan',
}
COUNTRY_ALIASES = {
    'usa': 'US', 'united states': 'US', 'uk': 'GB', 'united kingdom': 'GB',
    'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
    'georgia (country)': 'GE', 'georgia': 'GE', 'czech republic': 'CZ',
    'turkey': 'TR', 'ivory coast': 'CI', 'cape verde': 'CV', 'cabo verde': 'CV',
    'the gambia': 'GM', 'gambia': 'GM', 'east timor': 'TL', 'swaziland': 'SZ',
    'burma': 'MM', 'vatican': 'VA', 'holy see': 'VA',
    'micronesia': 'FM', 'federated states of micronesia': 'FM',
    'palestinian territory': 'PS', 'jerusalem': 'IL', 'macau': 'MO',
    'hong kong': 'HK', 'bahamas': 'BS', 'the bahamas': 'BS',
    'netherlands': 'NL', 'the netherlands': 'NL', 'martinique': 'MQ',
    'french guiana': 'GF', 'guadeloupe': 'GP', 'reunion': 'RE',
    'drc': 'CD', 'dr congo': 'CD', 'tibet': 'CN',
}
CONTINENT_NAMES = {'AF': 'Africa', 'AS': 'Asia', 'EU': 'Europe',
                   'NA': 'North America', 'SA': 'South America',
                   'OC': 'Oceania', 'AN': 'Antarctica'}
MIDDLE_EAST = set('AE BH CY EG IL IQ IR JO KW LB OM PS QA SA SY TR YE'.split())

# Landmarks / places geonames' city lists don't cover. lat, lon.
MANUAL = {
    'stonehenge': (51.1789, -1.8262), 'berlin wall': (52.5351, 13.3903),
    'mount everest': (27.9881, 86.9250), 'snowdon': (53.0685, -4.0763),
    'the matterhorn': (45.9763, 7.6586), 'matterhorn': (45.9763, 7.6586),
    'angel falls': (5.9701, -62.5362), 'mount yasur': (-19.5300, 169.4420),
    'uluru (ayers rock)': (-25.3444, 131.0369), 'uluru': (-25.3444, 131.0369),
    'christ the redeemer': (-22.9519, -43.2105),
    'aconcagua': (-32.6532, -70.0109), 'mount fuji': (35.3606, 138.7274),
    "st. peter's basilica": (41.9022, 12.4539),
    'kaaba (masjid al-haram)': (21.4225, 39.8262),
    'forbidden city': (39.9163, 116.3972), 'amazon river': (-3.4653, -58.3800),
    'grand canyon': (36.1069, -112.1129), 'pearl harbor': (21.3649, -157.9507),
    'walt disney concert hall': (34.0553, -118.2498),
    'battle of okinawa': (26.2124, 127.6809), 'hoi an old town': (15.8771, 108.3260),
    'wimbledon': (51.4340, -0.2143), 'the white house': (38.8977, -77.0365),
    'princeton university': (40.3431, -74.6551), 'monowi': (42.8297, -98.3298),
    'babylon': (32.5422, 44.4209), 'abu mena': (30.8411, 29.6622),
    'thaba bosiu': (-29.3500, 27.6833), 'cotapachi': (-17.3500, -66.2800),
    'cabangu': (-21.2500, -43.6000), 'mount kilimanjaro': (-3.0674, 37.3556),
    'victoria falls': (-17.9243, 25.8572), 'mount kenya': (-0.1521, 37.3084),
    'machu picchu': (-13.1631, -72.5450), 'petra': (30.3285, 35.4444),
    'taj mahal': (27.1751, 78.0421), 'eiffel tower': (48.8584, 2.2945),
    'colosseum': (41.8902, 12.4922), 'great pyramid of giza': (29.9792, 31.1342),
    'pyramids of giza': (29.9792, 31.1342), 'angkor wat': (13.4125, 103.8670),
    'chichen itza': (20.6843, -88.5678), 'easter island': (-27.1127, -109.3497),
    'galapagos islands': (-0.9538, -90.9656), 'mount kilimanjaro, tanzania': (-3.0674, 37.3556),
    'k2': (35.8800, 76.5151), 'rwenzori mountains': (0.3833, 29.8667),
    'mount elgon': (1.1340, 34.5500), 'mount ararat': (39.7019, 44.2983),
    'paektu mountain': (42.0050, 128.0560), 'mount paektu': (42.0050, 128.0560),
    'mont blanc': (45.8326, 6.8652), 'isles of scilly': (49.9360, -6.3220),
    'guadalcanal': (-9.5770, 160.1450), 'banda neira': (-4.5250, 129.9000),
    'ryotsu': (38.0833, 138.4333), 'stanley': (-51.6938, -57.8570),
    'ngerulmud': (7.5006, 134.6242), 'palikir': (6.9248, 158.1610),
    'ciudad de la paz': (1.6000, 10.6167), 'zanzibar': (-6.1659, 39.2026),
    'mount kinabalu': (6.0750, 116.5583), 'iguazu falls': (-25.6953, -54.4367),
    'al azhar university': (30.0458, 31.2627), 'al masjid an nabawi': (24.4672, 39.6112),
    'annapurna': (28.5961, 83.8203), 'aoraki / mount cook': (-43.5950, 170.1418),
    'arc de triomphe': (48.8738, 2.2950), 'baikonur cosmodrome': (45.9650, 63.3050),
    'bataan national park': (14.6417, 120.4100), 'beale street': (35.1390, -90.0526),
    'big ben (elizabeth tower)': (51.5007, -0.1246),
    'blue mosque (sultan ahmed mosque)': (41.0054, 28.9768),
    'borobudur': (-7.6079, 110.2038), 'brandenburg gate': (52.5163, 13.3777),
    'brasilia cathedral': (-15.7983, -47.8756), 'burj khalifa': (25.1972, 55.2744),
    'cn tower': (43.6426, -79.3871), 'cape of good hope': (-34.3568, 18.4740),
    'chimborazo': (-1.4693, -78.8169), 'church of the nativity': (31.7043, 35.2075),
    'ciudad de la costa': (-34.8167, -55.9500), 'darvaza gas crater': (40.2525, 58.4397),
    'elba': (42.7800, 10.2700), 'faisal mosque': (33.7299, 73.0372),
    'fallingwater': (39.9062, -79.4678), 'fort wagner': (32.7547, -79.8963),
    'gangnam': (37.4979, 127.0276), 'golan heights': (33.0000, 35.7500),
    'hagia sophia': (41.0086, 28.9802), 'hassan ii mosque': (33.6084, -7.6325),
    'huascaran': (-9.1222, -77.6042), 'klyuchevskaya sopka': (56.0560, 160.6420),
    'kualoa ranch': (21.5205, -157.8370), "martha's vineyard": (41.3900, -70.6200),
    'masada': (31.3156, 35.3539), 'mausoleum at halicarnassus': (37.0379, 27.4241),
    'mount apo': (6.9873, 125.2710), 'mount etna': (37.7510, 14.9934),
    'mount kosciuszko': (-36.4560, 148.2630), 'mount ol doinyo lengai': (-2.7640, 35.9140),
    'mount olympus': (40.0856, 22.3586), 'mount sinai': (28.5394, 33.9750),
    'mount stanley': (0.3860, 29.8720), 'mount vesuvius': (40.8210, 14.4260),
    'neuschwanstein castle': (47.5576, 10.7498), 'nineveh': (36.3594, 43.1528),
    'notre dame de paris': (48.8530, 2.3499), 'parthenon': (37.9715, 23.7267),
    'pashupatinath temple': (27.7105, 85.3487), 'petronas towers': (3.1579, 101.7116),
    'plymouth rock': (41.9580, -70.6620), 'potala palace': (29.6578, 91.1170),
    'puncak jaya': (-4.0833, 137.1833), 'roman forum': (41.8925, 12.4853),
    'shwedagon pagoda': (16.7984, 96.1497), 'sydney opera house': (-33.8568, 151.2153),
    'table mountain': (-33.9628, 18.4098), 'taipei 101': (25.0340, 121.5645),
    'temple of the tooth': (7.2936, 80.6413), 'terracotta army': (34.3841, 109.2785),
    'the new capital': (30.0200, 31.7600), 'the pyramids of giza': (29.9792, 31.1342),
    'thebes': (25.7188, 32.6573), 'three gorges dam': (30.8230, 111.0030),
    'tower bridge': (51.5055, -0.0754), 'valley of the kings': (25.7402, 32.6014),
    'wat phra kaew (temple of the emerald buddha)': (13.7516, 100.4927),
    'westminster abbey': (51.4994, -0.1273), 'hong kong': (22.3193, 114.1694),
    'macau': (22.1987, 113.5439),
}


def norm(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace('’', "'").replace('ʻ', "'").replace('ŭ', 'u')
    s = re.sub(r"[^a-z0-9' ()-]+", ' ', s)
    s = s.replace('-', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def write_js(name, key, obj):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('window.MT = window.MT || {};\nMT.%s = ' % key)
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('wrote %s (%.0f KB)' % (name, os.path.getsize(path) / 1024))


def load_geojson(name):
    with open(os.path.join(RAW, name + '.geojson'), encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- geometry

def dp(points, tol):
    """Iterative Douglas-Peucker."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = points[a][0], points[a][1]
        bx, by = points[b][0], points[b][1]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i][0], points[i][1]
            if dd == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / dd
                t = max(0.0, min(1.0, t))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > t2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(points, keep) if k]


def rnd(pt, nd):
    return [round(pt[0], nd), round(pt[1], nd)]


def simplify_ring(ring, tol, nd):
    s = dp(ring, tol)
    if len(s) < 4:
        s = ring if len(ring) <= 12 else dp(ring, tol / 10)
    out = []
    for p in s:
        q = rnd(p, nd)
        if not out or q != out[-1]:
            out.append(q)
    if len(out) < 4:
        return None
    return out


def simplify_geom(g, tol, nd=3):
    t = g['type']
    if t == 'Polygon':
        rings = [simplify_ring(r, tol, nd) for r in g['coordinates']]
        if not rings[0]:
            return None
        return {'type': 'Polygon', 'coordinates': [r for r in rings if r]}
    if t == 'MultiPolygon':
        polys = []
        for poly in g['coordinates']:
            p = simplify_geom({'type': 'Polygon', 'coordinates': poly}, tol, nd)
            if p:
                polys.append(p['coordinates'])
        if not polys:
            return None
        return {'type': 'MultiPolygon', 'coordinates': polys}
    if t == 'LineString':
        s = [rnd(p, nd) for p in dp(g['coordinates'], tol)]
        return {'type': 'LineString', 'coordinates': s} if len(s) >= 2 else None
    if t == 'MultiLineString':
        ls = [[rnd(p, nd) for p in dp(l, tol)] for l in g['coordinates']]
        ls = [l for l in ls if len(l) >= 2]
        return {'type': 'MultiLineString', 'coordinates': ls} if ls else None
    if t == 'Point':
        return {'type': 'Point', 'coordinates': rnd(g['coordinates'], nd)}
    raise ValueError(t)


def feature(geom, props):
    return {'type': 'Feature', 'geometry': geom, 'properties': props}


def fc(features):
    return {'type': 'FeatureCollection', 'features': features}


# ------------------------------------------------------------- countries

def load_country_info():
    info = {}
    with open(os.path.join(RAW, 'countryInfo.txt'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            c = line.rstrip('\n').split('\t')
            iso = c[0]
            cont = CONTINENT_NAMES.get(c[8], c[8])
            if iso in MIDDLE_EAST:
                cont = 'Middle East'
            info[iso] = {'name': COUNTRY_DISPLAY.get(iso, c[4]), 'gn': c[4],
                         'cont': cont, 'capital': c[5]}
    return info


def build_countries(cinfo):
    d = load_geojson('ne_10m_admin_0_countries')
    feats = []
    for f in d['features']:
        p = f['properties']
        iso = p['ISO_A2_EH'] if p['ISO_A2_EH'] != '-99' else p['ISO_A2']
        name = cinfo.get(iso, {}).get('name') or p['NAME']
        g = simplify_geom(f['geometry'], 0.01)
        if not g:
            continue
        feats.append(feature(g, {'name': name, 'iso': iso,
                                 'lx': round(p['LABEL_X'], 2), 'ly': round(p['LABEL_Y'], 2),
                                 'rank': p['LABELRANK']}))
    write_js('countries.js', 'countries', fc(feats))


def build_admin1():
    d = load_geojson('ne_10m_admin_1_states_provinces')
    feats = []
    for f in d['features']:
        p = f['properties']
        if p['iso_a2'] not in STATE_COUNTRIES:
            continue
        g = simplify_geom(f['geometry'], 0.008)
        if not g:
            continue
        feats.append(feature(g, {'name': p['name'], 'iso': p['iso_a2'],
                                 'type': p['type_en'],
                                 'lx': round(p['longitude'], 2), 'ly': round(p['latitude'], 2)}))
    write_js('admin1.js', 'admin1', fc(feats))


# ---------------------------------------------------------------- physical

def build_physical():
    out = {}
    d = load_geojson('ne_10m_geography_regions_polys')
    keep = {'Range/mtn': 'range', 'Desert': 'desert', 'Plateau': 'plateau',
            'Basin': 'basin', 'Plain': 'plain', 'Delta': 'delta',
            'Peninsula': 'peninsula', 'Valley': 'valley', 'Lowland': 'plain',
            'Tundra': 'plain', 'Depression': 'basin', 'Wetlands': 'plain',
            'Foothills': 'range', 'Isthmus': 'peninsula', 'Pen/cape': 'peninsula',
            'Island group': 'islands', 'Geoarea': 'region'}
    feats = []
    for f in d['features']:
        p = f['properties']
        k = keep.get(p['FEATURECLA'])
        if not k or not p['NAME']:
            continue
        g = simplify_geom(f['geometry'], 0.03, 2)
        if g:
            feats.append(feature(g, {'name': p['NAME'], 'kind': k,
                                     'rank': p['SCALERANK']}))
    out['regions'] = fc(feats)

    d = load_geojson('ne_10m_geography_regions_elevation_points')
    out['peaks'] = fc([feature(simplify_geom(f['geometry'], 0),
                               {'name': f['properties']['name'],
                                'elev': f['properties']['elevation'],
                                'rank': f['properties']['scalerank']})
                       for f in d['features'] if f['properties']['name']])

    d = load_geojson('ne_10m_rivers_lake_centerlines')
    feats = []
    for f in d['features']:
        p = f['properties']
        if p['featurecla'] != 'River' or p['scalerank'] > 9:
            continue
        g = simplify_geom(f['geometry'], 0.005, 3)
        if g:
            feats.append(feature(g, {'name': p['name'] or '', 'rank': p['scalerank']}))
    out['rivers'] = fc(feats)

    d = load_geojson('ne_50m_lakes')
    out['lakes'] = fc([feature(simplify_geom(f['geometry'], 0.02, 2),
                               {'name': f['properties']['name'] or '',
                                'rank': f['properties']['scalerank']})
                       for f in d['features'] if simplify_geom(f['geometry'], 0.02, 2)])

    d = load_geojson('ne_50m_geography_marine_polys')
    out['seas'] = fc([feature(simplify_geom(f['geometry'], 0.05, 2),
                              {'name': f['properties']['name'],
                               'kind': f['properties']['featurecla'],
                               'rank': f['properties']['scalerank']})
                      for f in d['features']
                      if f['properties']['name'] and simplify_geom(f['geometry'], 0.05, 2)])
    write_js('physical.js', 'physical', out)

    # Flat water, painted over the imagery like maptap does. 10m so coastlines
    # still line up with the imagery at regional zoom levels.
    write_js('ocean.js', 'ocean', fc(grid_split(load_geojson('ne_10m_ocean')['features'], 0.004)))
    lakes = [f for f in load_geojson('ne_10m_lakes')['features'] if f['properties']['scalerank'] <= 7]
    write_js('lakes.js', 'lakes', fc(grid_split(lakes, 0.004)))


def grid_split(features, tol, cell=10):
    """Simplify polygons topology-safely and cut them into cell x cell degree pieces.

    Natural Earth's 10m ocean is one world-sized polygon with ~6800 holes. Fed
    to MapLibre as-is (especially after naive simplification) its triangulation
    breaks and paints bands of water across land, so repair it and hand over
    many small valid polygons instead. Needs shapely (build time only)."""
    from shapely.geometry import shape, box, mapping
    from shapely.validation import make_valid
    geoms = [make_valid(shape(f['geometry']).simplify(tol, preserve_topology=True)) for f in features]
    out = []
    for x in range(-180, 180, cell):
        for y in range(-90, 90, cell):
            b = box(x, y, x + cell, y + cell)
            for g in geoms:
                if not g.intersects(b):
                    continue
                piece = make_valid(g.intersection(b))
                parts = getattr(piece, 'geoms', [piece])
                for p in parts:
                    if p.geom_type not in ('Polygon', 'MultiPolygon') or p.is_empty:
                        continue
                    m = mapping(p)
                    out.append(feature({'type': m['type'], 'coordinates': json.loads(json.dumps(
                        m['coordinates'], default=list), parse_float=lambda v: round(float(v), 3))}, {}))
    return out


# ------------------------------------------------------------------ cities

def load_admin1_names():
    names = {}
    with open(os.path.join(RAW, 'admin1CodesASCII.txt'), encoding='utf-8') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            names[c[0]] = c[1]
    return names


ADMIN1_FIX = {
    'Federal District': 'Federal District', 'NCT': 'Delhi',
    'National Capital Territory of Delhi': 'Delhi',
}


def clean_admin1(s):
    s = ADMIN1_FIX.get(s, s)
    s = re.sub(r'^(State of|Provincia de|Estado de) ', '', s)
    return s


def read_cities(path, a1names):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            if c[6] != 'P':
                continue
            cc = c[8]
            a1 = clean_admin1(a1names.get(cc + '.' + c[10], ''))
            rows.append({'id': int(c[0]), 'name': c[1], 'ascii': c[2],
                         'alt': c[3], 'lat': float(c[4]), 'lon': float(c[5]),
                         'fcode': c[7], 'cc': cc, 'a1': a1,
                         'pop': int(c[14] or 0)})
    return rows


def haversine(a_lat, a_lon, b_lat, b_lon):
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2 +
         math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lon - a_lon) * p / 2) ** 2)
    return 12742 * math.asin(min(1, math.sqrt(h)))


def find_satellites(rows, km=40, ratio=2):
    """Indexes of cities with a city at least `ratio`x bigger within `km`.

    rows must be sorted by population, descending."""
    grid = {}
    sats = set()
    for i, r in enumerate(rows):
        gy, gx = int(r['lat'] // 1), int(r['lon'] // 1)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    o = rows[j]
                    if o['pop'] > ratio * r['pop'] and \
                            3 < haversine(r['lat'], r['lon'], o['lat'], o['lon']) <= km:
                        sats.add(i)
                        break
        grid.setdefault((gy, gx), []).append(i)
    return sats


def maptap_logit(pop, flag, satellite):
    """How likely maptap is to ask about a city, x100 (a logit).

    Logistic fit over ~920 cities maptap asked in one player's history vs. all
    GeoNames cities >15k: bigger is likelier, admin/national capitals much
    likelier, and suburbs/satellites of a 2x-bigger city within 40 km ~3.5x
    less likely (e.g. Gazipur next to Dhaka)."""
    z = (-3.91 + 2.23 * (math.log10(max(pop, 1)) - 5) + 1.74 * (flag == 1) +
         4.62 * (flag == 2) - 1.25 * satellite)
    return int(round(z * 100))


def build_cities(cinfo, a1names):
    rows = read_cities(os.path.join(RAW, 'cities15000.txt'), a1names)
    # Drop city sections/neighbourhoods; they clutter labels.
    rows = [r for r in rows if r['fcode'] not in ('PPLX', 'PPLH', 'PPLQ', 'PPLW')]
    rows.sort(key=lambda r: -r['pop'])
    satellites = find_satellites(rows)
    a1_list, a1_idx = [], {}
    out = []
    for i, r in enumerate(rows):
        flag = 2 if r['fcode'] == 'PPLC' else (1 if r['fcode'] == 'PPLA' else 0)
        key = r['cc'] + '|' + r['a1']
        if key not in a1_idx:
            a1_idx[key] = len(a1_list)
            a1_list.append(r['a1'])
        out.append([r['name'], round(r['lat'], 3), round(r['lon'], 3), r['pop'],
                    r['cc'], a1_idx[key], flag, maptap_logit(r['pop'], flag, i in satellites)])
    countries = {k: [v['name'], v['cont']] for k, v in cinfo.items()}
    write_js('cities.js', 'cities', {
        'fields': ['name', 'lat', 'lon', 'pop', 'cc', 'a1', 'flag', 'likely'],
        'admin1': a1_list, 'countries': countries,
        'stateCountries': STATE_COUNTRIES, 'rows': out})
    return rows


# --------------------------------------------------------------- geocoding

def read_score_locations():
    locs = {}
    for path in glob.glob(os.path.join(SCORES, '*.csv')):
        with open(path, encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                if 'Location' in r:
                    locs[r['Location']] = r.get('Continent', '')
                for i in range(1, 6):
                    k = 'Round %d Location' % i
                    if r.get(k):
                        locs.setdefault(r[k], '')
    return locs


def build_seen(cinfo, a1names):
    locs = read_score_locations()
    if not locs:
        print('no score CSVs found; skipping seen.js')
        return
    rows = read_cities(os.path.join(RAW, 'cities1000.txt'), a1names)
    country_by_name = dict(COUNTRY_ALIASES)
    for iso, v in cinfo.items():
        country_by_name[norm(v['name'])] = iso
        country_by_name[norm(v['gn'])] = iso
    index = {}
    for r in rows:
        names = {norm(r['name']), norm(r['ascii'])}
        names.update(norm(a) for a in r['alt'].split(',') if a and len(a) < 40)
        for n in names:
            index.setdefault((n, r['cc']), []).append(r)

    def lookup(name, cc, state):
        cands = []
        for n in {norm(name), norm(re.sub(r'\bSt\.? ', 'Saint ', name)),
                  norm(re.sub(r' City$', '', name)), norm(name.replace('Saint ', 'St. '))}:
            cands += index.get((n, cc), [])
        if not cands:
            return None
        def score(r):
            s = math.log10(r['pop'] + 10)
            if state and norm(state) in norm(r['a1']):
                s += 5
            if r['fcode'] in ('PPLC', 'PPLA'):
                s += 1
            return s
        return max(cands, key=score)

    out, missing = [], []
    for loc, cont in sorted(locs.items()):
        parts = [p.strip() for p in loc.split(',')]
        last = norm(parts[-1])
        hit = None
        cc = country_by_name.get(last) if len(parts) > 1 else None
        if len(parts) == 1:
            cc = country_by_name.get(last) or {'gibraltar': 'GI', 'luxembourg': 'LU',
                                               'monaco': 'MC', 'singapore': 'SG',
                                               'jerusalem': 'IL'}.get(last)
        if '/' in parts[-1]:
            cc = country_by_name.get(norm(parts[-1].split('/')[0]))
        if len(parts) == 3 and norm(parts[1]) in country_by_name and                 country_by_name[norm(parts[1])] not in ('GB', 'GE', 'CN'):
            cc = country_by_name[norm(parts[1])]
        if cc is None and len(parts) > 1 and norm(parts[-2]) in country_by_name:
            cc = country_by_name[norm(parts[-2])]
        state = parts[1] if len(parts) == 3 else None
        manual = MANUAL.get(norm(parts[0])) or MANUAL.get(parts[0].lower())
        if manual:
            hit = {'lat': manual[0], 'lon': manual[1], 'pop': 0}
        elif cc:
            hit = lookup(parts[0], cc, state)
            if not hit and state:
                # e.g. "Christ the Redeemer, Rio de Janeiro" or island names
                hit = lookup(state, cc, None)
        if not hit:
            missing.append(loc)
            continue
        out.append([loc, round(hit['lat'], 3), round(hit['lon'], 3), cc or '',
                    hit.get('pop', 0)])
    print('geocoded %d/%d score locations' % (len(out), len(locs)))
    if missing:
        print('MISSING:', missing)
    write_js('seen.js', 'seen', out)


def main():
    os.makedirs(OUT, exist_ok=True)
    cinfo = load_country_info()
    a1names = load_admin1_names()
    only = set(sys.argv[3:])
    if not only or 'countries' in only:
        build_countries(cinfo)
    if not only or 'admin1' in only:
        build_admin1()
    if not only or 'physical' in only:
        build_physical()
    if not only or 'cities' in only:
        build_cities(cinfo, a1names)
    if not only or 'seen' in only:
        build_seen(cinfo, a1names)


if __name__ == '__main__':
    main()
