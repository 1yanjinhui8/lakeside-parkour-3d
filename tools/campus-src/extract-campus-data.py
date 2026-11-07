"""把 z14 图层导出成米制 JSON，用于规划「真实校园走廊」。"""
import os, sys, json, glob, math
sys.path.insert(0, r'D:\阿布\projects\pku-campus-3d')
import mvt_lib as M

TILE_DIR = r'D:\阿布\projects\pku-campus-3d\tiles'
OUT = r'D:\阿布\tmp\pku_z14.json'
LON_MIN, LON_MAX = 116.2960, 116.3240
LAT_MIN, LAT_MAX = 39.9820, 40.0080
LON0, LAT0 = 116.3100, 39.9895
MLAT = 110574.0
MLON = 111320.0 * math.cos(math.radians(LAT0))


def to_m(lon, lat):
    return ((lon - LON0) * MLON, (lat - LAT0) * MLAT)


def geom_rings(feat):
    return M.decode_geometry(feat['geom'])


out = {'building': [], 'water': [], 'green': [], 'ground': [], 'road': []}
GREEN = ('grass', 'wood', 'forest', 'meadow', 'wetland', 'scrub')
GROUND = ('pitch', 'track', 'stadium', 'playground', 'university', 'school',
          'library', 'recreation_ground', 'garden')

for path in sorted(glob.glob(os.path.join(TILE_DIR, '*.pbf'))):
    z, tx, ty = [int(v) for v in os.path.basename(path)[:-4].split('_')]
    for layer in M.decode_tile(open(path, 'rb').read()):
        lname = layer['name']
        if lname not in ('building', 'water', 'landcover', 'landuse', 'transportation'):
            continue
        ext = layer['extent']
        for feat in layer['features']:
            props = M.feature_props(layer, feat)
            cls = props.get('class')
            if lname == 'transportation':
                if feat['type'] not in (2, 3):
                    continue
                lines = []
                for r in geom_rings(feat):
                    if len(r) < 2:
                        continue
                    lines.append([list(to_m(*M.tile_to_lonlat(z, tx, ty, p[0], p[1], ext))) for p in r])
                if not lines:
                    continue
                out['road'].append({'cls': cls, 'sub': props.get('subclass'),
                                    'layer': props.get('layer'), 'lines': lines})
                continue
            if feat['type'] != 3:
                continue
            for r in geom_rings(feat):
                if len(r) < 3:
                    continue
                cx = sum(p[0] for p in r) / float(len(r))
                cy = sum(p[1] for p in r) / float(len(r))
                lon, lat = M.tile_to_lonlat(z, tx, ty, cx, cy, ext)
                if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
                    continue
                pts = [list(to_m(*M.tile_to_lonlat(z, tx, ty, p[0], p[1], ext))) for p in r]
                if lname == 'building':
                    out['building'].append({'p': pts, 'h': props.get('render_height'),
                                            'mh': props.get('render_min_height')})
                elif lname == 'water':
                    out['water'].append({'p': pts, 'cls': cls})
                elif lname == 'landcover':
                    if cls in GREEN:
                        out['green'].append({'p': pts, 'cls': cls})
                elif lname == 'landuse':
                    if cls in GROUND:
                        out['ground'].append({'p': pts, 'cls': cls})
                    elif cls in GREEN:
                        out['green'].append({'p': pts, 'cls': cls})

json.dump(out, open(OUT, 'w', encoding='utf-8'))
for k, v in out.items():
    print('%-9s %5d' % (k, len(v)))

# 未名湖水面范围
waters = [w for w in out['water']]
waters.sort(key=lambda w: -(len(w['p'])))
print('\n最大 6 个水面（米制 x/y，原点=116.31,39.9895）：')
for w in waters[:6]:
    xs = [p[0] for p in w['p']]
    ys = [p[1] for p in w['p']]
    print('  n=%3d  x[%7.1f,%7.1f] y[%7.1f,%7.1f]  cls=%s' % (
        len(w['p']), min(xs), max(xs), min(ys), max(ys), w['cls']))
