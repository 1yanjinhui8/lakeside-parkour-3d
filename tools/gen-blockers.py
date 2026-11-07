# -*- coding: utf-8 -*-
"""导出两块校园底板的建筑包围盒，供 js/art.js 摆件避让。

不避让的后果：行道树会长在楼里（截图里能看到树冠从红砖楼顶穿出来）。
只导出 xz 平面的 AABB，693 栋 ≈ 11KB，比内联整份 GeoJSON 便宜得多。
"""
import io, json, os
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SETS = [
    ('campus', 'assets/campus/_src/pku_z14.json'),
    ('campus2', 'assets/campus2/_src/bmu_z14.json'),
]
out = {}
for key, rel in SETS:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        out[key] = []
        continue
    d = json.load(io.open(p, encoding='utf-8'))
    boxes = []
    for b in d.get('building', []):
        cs = b.get('p')
        if not cs or len(cs) < 3:
            continue
        try:
            g = Polygon(cs).buffer(0)
        except Exception:
            continue
        if g.is_empty:
            continue
        x0, z0, x1, z1 = g.bounds
        boxes.append([round(x0, 1), round(z0, 1), round(x1, 1), round(z1, 1)])
    out[key] = boxes
    print(key, len(boxes), 'buildings')

js = '// 由 tools/gen-blockers.py 生成：建筑 AABB（x0,z0,x1,z1），摆件避让用\n'
js += 'const ART_BLOCKERS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
io.open(os.path.join(ROOT, 'js', 'art-blockers.js'), 'w', encoding='utf-8', newline='').write(js)
print('js/art-blockers.js', len(js) // 1024, 'KB')
