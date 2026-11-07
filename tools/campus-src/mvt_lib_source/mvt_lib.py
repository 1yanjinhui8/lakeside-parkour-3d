"""Minimal Mapbox Vector Tile (MVT / protobuf) decoder - no external deps."""
import struct


def read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, pos


def zigzag(n):
    return (n >> 1) ^ (-(n & 1))


def parse_fields(buf):
    pos = 0
    n = len(buf)
    out = []
    while pos < n:
        key, pos = read_varint(buf, pos)
        fno = key >> 3
        wt = key & 7
        if wt == 0:
            v, pos = read_varint(buf, pos)
            out.append((fno, wt, v))
        elif wt == 2:
            ln, pos = read_varint(buf, pos)
            v = buf[pos:pos + ln]
            pos += ln
            out.append((fno, wt, v))
        elif wt == 5:
            v = struct.unpack('<f', buf[pos:pos + 4])[0]
            pos += 4
            out.append((fno, wt, v))
        elif wt == 1:
            v = struct.unpack('<d', buf[pos:pos + 8])[0]
            pos += 8
            out.append((fno, wt, v))
        else:
            raise ValueError('unsupported wiretype %d' % wt)
    return out


def _packed_uint32(buf):
    arr = []
    p = 0
    while p < len(buf):
        x, p = read_varint(buf, p)
        arr.append(x)
    return arr


def decode_value(buf):
    for fno, wt, v in parse_fields(buf):
        if fno == 1:
            return v.decode('utf-8', 'replace')
        if fno == 2:
            return v
        if fno == 3:
            return v
        if fno == 4:
            return v if v < (1 << 63) else v - (1 << 64)
        if fno == 5:
            return v
        if fno == 6:
            return zigzag(v)
        if fno == 7:
            return bool(v)
    return None


def decode_feature(buf):
    fid = None
    tags = []
    gtype = 0
    geom = []
    for fno, wt, v in parse_fields(buf):
        if fno == 1:
            fid = v
        elif fno == 2:
            tags = _packed_uint32(v)
        elif fno == 3:
            gtype = v
        elif fno == 4:
            geom = _packed_uint32(v)
    return {'id': fid, 'tags': tags, 'type': gtype, 'geom': geom}


def decode_geometry(cmds):
    """Return list of rings; each ring is a list of (x, y) in tile-local units."""
    i = 0
    x = y = 0
    rings = []
    ring = None
    n = len(cmds)
    while i < n:
        c = cmds[i]
        i += 1
        cmd = c & 7
        count = c >> 3
        if cmd == 1:
            for _ in range(count):
                if i + 1 >= n:
                    return rings
                x += zigzag(cmds[i])
                y += zigzag(cmds[i + 1])
                i += 2
                ring = [(x, y)]
                rings.append(ring)
        elif cmd == 2:
            for _ in range(count):
                if i + 1 >= n:
                    return rings
                x += zigzag(cmds[i])
                y += zigzag(cmds[i + 1])
                i += 2
                if ring is not None:
                    ring.append((x, y))
        elif cmd == 7:
            pass
        else:
            return rings
    return rings


def decode_layer(buf):
    name = ''
    extent = 4096
    keys = []
    values = []
    feats = []
    for fno, wt, v in parse_fields(buf):
        if fno == 1:
            name = v.decode('utf-8', 'replace')
        elif fno == 5:
            extent = v
        elif fno == 3:
            keys.append(v.decode('utf-8', 'replace'))
        elif fno == 4:
            values.append(decode_value(v))
        elif fno == 2:
            feats.append(decode_feature(v))
    return {'name': name, 'extent': extent, 'keys': keys,
            'values': values, 'features': feats}


def decode_tile(data):
    layers = []
    for fno, wt, v in parse_fields(data):
        if fno == 3 and wt == 2:
            layers.append(decode_layer(v))
    return layers


def feature_props(layer, feat):
    props = {}
    tags = feat['tags']
    for i in range(0, len(tags) - 1, 2):
        ki = tags[i]
        vi = tags[i + 1]
        if ki < len(layer['keys']) and vi < len(layer['values']):
            props[layer['keys'][ki]] = layer['values'][vi]
    return props


def tile_to_lonlat(z, tx, ty, px, py, extent):
    import math
    n = 2.0 ** z
    lon = (tx + px / extent) / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / extent) / n)))
    return lon, math.degrees(lat_rad)
