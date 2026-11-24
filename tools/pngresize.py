import struct, zlib, sys, os

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    i = 8
    idat = []
    w = h = bd = ct = None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]
        typ = d[i+4:i+8]
        data = d[i+8:i+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct, cm, fm, il = struct.unpack('>IIBBBBB', data)
            assert bd == 8 and ct == 6 and il == 0, 'need 8-bit RGBA non-interlaced'
        elif typ == b'IDAT':
            idat.append(data)
        elif typ == b'IEND':
            break
        i += 12 + ln
    raw = zlib.decompress(b''.join(idat))
    bpp = 4
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x-bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x-bpp] if x >= bpp else 0
                p = a + b - c
                pa = abs(p-a); pb = abs(p-b); pc = abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, out

def resize(w, h, px, nw, nh):
    out = bytearray(nw * nh * 4)
    xr = w / float(nw)
    yr = h / float(nh)
    for oy in range(nh):
        y0 = int(oy * yr); y1 = max(y0+1, int((oy+1) * yr))
        if y1 > h: y1 = h
        for ox in range(nw):
            x0 = int(ox * xr); x1 = max(x0+1, int((ox+1) * xr))
            if x1 > w: x1 = w
            r = g = b = a = 0; n = 0
            for yy in range(y0, y1):
                base = yy * w * 4
                for xx in range(x0, x1):
                    o = base + xx*4
                    r += px[o]; g += px[o+1]; b += px[o+2]; a += px[o+3]; n += 1
            o = (oy*nw+ox)*4
            out[o] = r//n; out[o+1] = g//n; out[o+2] = b//n; out[o+3] = a//n
    return out

def write_png(path, w, h, px):
    raw = bytearray()
    stride = w*4
    for y in range(h):
        raw.append(0)
        raw += px[y*stride:(y+1)*stride]
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

if __name__ == '__main__':
    src = sys.argv[1]
    outdir = sys.argv[2]
    sizes = [int(s) for s in sys.argv[3].split(',')]
    w, h, px = read_png(src)
    sys.stderr.write('decoded %dx%d\n' % (w, h))
    for s in sizes:
        r = resize(w, h, px, s, s)
        p = os.path.join(outdir, 'icon-%d.png' % s)
        write_png(p, s, s, r)
        sys.stderr.write('wrote %s (%d bytes)\n' % (p, os.path.getsize(p)))