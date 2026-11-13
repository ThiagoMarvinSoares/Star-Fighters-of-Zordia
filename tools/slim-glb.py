#!/usr/bin/env python3
"""Enxuga um .glb para o jogo:  python3 tools/slim-glb.py entrada.glb saida.glb [--grid N] [--opaque] [--flip] [--pbr]

O jogo usa materiais foscos, então só precisa de posição, normal, cor, a textura de cor e a de brilho próprio.
Sai o resto: tangentes, mapas de normal / metal-rugosidade / oclusão, os conjuntos de UV que só eles usavam, as
extensões de material e as animações (o modelo fica na pose do arquivo). Cada dado que fica é regravado apertado.

--grid N também reduz os triângulos: divide o modelo numa grade de N casas no lado maior e funde os vértices que caem
na mesma casa (sem misturar lados opostos de uma chapa nem regiões distantes da textura). Como as naves aparecem
pequenas, uma casa de 1 a 2 pixels de tela não se nota: N entre 96 e 128 para naves, uns 200 para a base.

--opaque tira a transparência dos materiais: para modelos marcados como transparentes cuja textura é opaca (desenhar
como transparente só traria defeitos de sobreposição).

--pbr mantém as texturas de relevo, metal/rugosidade e oclusão. O jogo desenha esses modelos com o material completo
(mais bonito e mais pesado); é usado nas naves do jogador. Sem ele, o modelo sai só com cor e brilho próprio (fosco).

--flip vira o modelo de frente para trás: para arquivos feitos de costas (o jogo espera a frente em +Z)."""
import json, struct, sys
from array import array

SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
ICODE = {5121: 'B', 5123: 'H', 5125: 'I'}

def matmul(a, b):  # 4x4 em ordem de colunas, como no glTF
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]

def local(n):
    if 'matrix' in n: return n['matrix']
    t, s = n.get('translation', [0, 0, 0]), n.get('scale', [1, 1, 1]); x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, *t, 1]

def slim(src, dst, grid=0, opaque=False, flip=False, full=False):
    b = open(src, 'rb').read()
    assert b[:4] == b'glTF', 'não é um arquivo .glb'
    clen, = struct.unpack('<I', b[12:16]); j = json.loads(b[20:20 + clen]); bin0 = 20 + clen + 8
    assert not j.get('skins'), 'modelos com esqueleto não são suportados por este script'
    assert 'EXT_meshopt_compression' not in j.get('extensionsUsed', []), 'arquivo já comprimido: rode este script antes de tools/compress-glb.mjs'
    j.pop('animations', None)  # o jogo mostra o modelo parado, na pose do arquivo
    if flip:  # meia-volta em torno do eixo vertical, com um nó novo acima de tudo
        sc = j['scenes'][j.get('scene', 0)]
        j['nodes'].append({'name': 'flip', 'rotation': [0, 1, 0, 0], 'children': sc['nodes']}); sc['nodes'] = [len(j['nodes']) - 1]
    mats = j.get('materials', [])
    # full (--pbr): ficam também relevo, metal/rugosidade e oclusão, e o jogo desenha o modelo com o material completo
    kept = lambda m: [t for t in (m.get('emissiveTexture'), m.get('pbrMetallicRoughness', {}).get('baseColorTexture')) +
                      ((m.get('normalTexture'), m.get('occlusionTexture'), m.get('pbrMetallicRoughness', {}).get('metallicRoughnessTexture')) if full else ()) if t]
    for m in mats:
        sg = m.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness')
        if sg:  # formato antigo de material: a cor e a textura de cor ficam dentro da extensão; passam para o lugar padrão
            pbr = m.setdefault('pbrMetallicRoughness', {})
            if 'diffuseTexture' in sg: pbr.setdefault('baseColorTexture', sg['diffuseTexture'])
            if 'diffuseFactor' in sg: pbr.setdefault('baseColorFactor', sg['diffuseFactor'])
            # o formato antigo não tem "metal": fica não metálico, com a rugosidade tirada do brilho que ele pedia
            pbr.setdefault('metallicFactor', 0); pbr.setdefault('roughnessFactor', 1 - sg.get('glossinessFactor', 1))
        if opaque: m.pop('alphaMode', None)
        if not full:
            m.pop('normalTexture', None); m.pop('occlusionTexture', None)
            m.get('pbrMetallicRoughness', {}).pop('metallicRoughnessTexture', None)
        # extensões de material (brilho especular, verniz...) não servem a um material fosco e apontam para texturas
        # que estão saindo; só a força do brilho próprio é mantida
        ext = {k: v for k, v in m.get('extensions', {}).items() if k == 'KHR_materials_emissive_strength'}
        if ext: m['extensions'] = ext
        else: m.pop('extensions', None)
    used = {k for m in mats for k in m.get('extensions', {})}
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in j:
            j[key] = [e for e in j[key] if not e.startswith('KHR_materials_') or e in used]
            if not j[key]: del j[key]
    uvs = {0} | {t.get('texCoord', 0) for m in mats for t in kept(m)}
    for mesh in j['meshes']:
        for p in mesh['primitives']:
            for k in list(p['attributes']):
                if k == 'TANGENT' or k.startswith('TEXCOORD_') and int(k[9:]) not in uvs: del p['attributes'][k]
    # texturas e imagens ainda usadas, renumeradas
    tex = sorted({t['index'] for m in mats for t in kept(m)}); tmap = {o: n for n, o in enumerate(tex)}
    for m in mats:
        for t in kept(m): t['index'] = tmap[t['index']]
    j['textures'] = [j.get('textures', [])[o] for o in tex]
    img = sorted({t['source'] for t in j['textures']}); imap = {o: n for n, o in enumerate(img)}
    for t in j['textures']: t['source'] = imap[t['source']]
    j['images'] = [j.get('images', [])[o] for o in img]
    for k in ('textures', 'images'):
        if not j[k]: del j[k]

    old_acc, old_views = j['accessors'], j['bufferViews']
    def raw(o):  # bytes de um acessor, apertados
        a = old_acc[o]; assert 'sparse' not in a
        v = old_views[a['bufferView']]; size = SIZE[a['componentType']] * COUNT[a['type']]; stride = v.get('byteStride') or size
        at = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return b[at:at + a['count'] * size] if stride == size else b''.join(b[at + i * stride:at + i * stride + size] for i in range(a['count']))
    out, views, accessors, copied = bytearray(), [], [], {}
    def view(data, target=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        out.extend(data); views.append(v)
        return len(views) - 1
    def push(a):
        accessors.append(a); return len(accessors) - 1
    def copy(o):  # acessor mantido como está, regravado na sua própria vista
        if o not in copied:
            a = dict(old_acc[o]); a['bufferView'] = view(raw(o), old_views[a['bufferView']].get('target')); a.pop('byteOffset', None); copied[o] = push(a)
        return copied[o]

    # tamanho do modelo no mundo e escala de cada malha, para a grade ter o mesmo tamanho em todas as peças
    cell = {}
    if grid:
        world, lo, hi = {}, [1e30] * 3, [-1e30] * 3
        def walk(i, m):
            n = j['nodes'][i]; m = matmul(m, local(n))
            if 'mesh' in n: world.setdefault(n['mesh'], m)
            for c in n.get('children', []): walk(c, m)
        for root in j['scenes'][j.get('scene', 0)]['nodes']: walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
        for mi, m in world.items():
            for p in j['meshes'][mi]['primitives']:
                a = old_acc[p['attributes']['POSITION']]
                for x in (a['min'][0], a['max'][0]):
                    for y in (a['min'][1], a['max'][1]):
                        for z in (a['min'][2], a['max'][2]):
                            w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
                            lo = [min(lo[k], w[k]) for k in range(3)]; hi = [max(hi[k], w[k]) for k in range(3)]
        side = max(hi[k] - lo[k] for k in range(3)) / grid
        for mi, m in world.items():
            det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])
            cell[mi] = side / (abs(det) ** (1 / 3) or 1)

    def decimate(p, c):
        """funde os vértices por casa da grade; devolve os novos atributos e índices, ou None se a peça não é suportada"""
        names = list(p['attributes'])
        if 'indices' not in p or p.get('mode', 4) != 4 or 'NORMAL' not in names: return None
        if any(old_acc[p['attributes'][k]]['componentType'] != 5126 for k in names) or any(k not in ('POSITION', 'NORMAL') and not k.startswith('TEXCOORD_') for k in names): return None
        data = {k: array('f', raw(p['attributes'][k])) for k in names}
        ia = old_acc[p['indices']]; idx = array(ICODE[ia['componentType']], raw(p['indices']))
        P, N = data['POSITION'], data['NORMAL']; U = data.get('TEXCOORD_0'); mn = old_acc[p['attributes']['POSITION']]['min']
        extra = [k for k in names if k.startswith('TEXCOORD_')]
        cells, clusters, remap = {}, {}, [0] * (len(P) // 3)
        for i in range(len(P) // 3):
            x, y, z = P[i * 3], P[i * 3 + 1], P[i * 3 + 2]
            ck = (int((x - mn[0]) / c), int((y - mn[1]) / c), int((z - mn[2]) / c))
            s = cells.get(ck)
            if s is None: cells[ck] = [x, y, z, 1]
            else: s[0] += x; s[1] += y; s[2] += z; s[3] += 1
            # dentro da casa, não mistura faces viradas para lados opostos nem pontos distantes na textura
            key = (ck, N[i * 3] > 0, N[i * 3 + 1] > 0, N[i * 3 + 2] > 0, int(U[i * 2] * 16) if U else 0, int(U[i * 2 + 1] * 16) if U else 0)
            q = clusters.get(key)
            if q is None: q = clusters[key] = [len(clusters), 0, 0.0, 0.0, 0.0] + [0.0] * (2 * len(extra))
            q[1] += 1; q[2] += N[i * 3]; q[3] += N[i * 3 + 1]; q[4] += N[i * 3 + 2]
            for e, k in enumerate(extra): q[5 + e * 2] += data[k][i * 2]; q[6 + e * 2] += data[k][i * 2 + 1]
            remap[i] = q[0]
        n = len(clusters); pos, nor = array('f', bytes(12 * n)), array('f', bytes(12 * n)); uv = {k: array('f', bytes(8 * n)) for k in extra}
        for key, q in clusters.items():
            i, cnt = q[0], q[1]; s = cells[key[0]]
            pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2] = s[0] / s[3], s[1] / s[3], s[2] / s[3]
            l = (q[2] ** 2 + q[3] ** 2 + q[4] ** 2) ** .5 or 1
            nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2] = q[2] / l, q[3] / l, q[4] / l
            for e, k in enumerate(extra): uv[k][i * 2], uv[k][i * 2 + 1] = q[5 + e * 2] / cnt, q[6 + e * 2] / cnt
        tris, seen = array('I'), set()
        for t in range(0, len(idx) - 2, 3):
            a, b2, c2 = remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]
            if a == b2 or b2 == c2 or a == c2: continue  # o triângulo encolheu até sumir
            k = tuple(sorted((a, b2, c2)))
            if k in seen: continue
            seen.add(k); tris.extend((a, b2, c2))
        xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
        att = {'POSITION': push({'bufferView': view(pos.tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3',
                                 'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]}),
               'NORMAL': push({'bufferView': view(nor.tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3'})}
        for k in extra: att[k] = push({'bufferView': view(uv[k].tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC2'})
        return att, push({'bufferView': view(tris.tobytes(), 34963), 'componentType': 5125, 'count': len(tris), 'type': 'SCALAR'})

    before = after = 0
    for mi, mesh in enumerate(j['meshes']):
        prims = []
        for p in mesh['primitives']:
            n0 = (old_acc[p['indices']]['count'] if 'indices' in p else old_acc[p['attributes']['POSITION']]['count']) // 3; before += n0
            r = decimate(p, cell[mi]) if mi in cell else None
            if r: p['attributes'], p['indices'] = r
            else:
                p['attributes'] = {k: copy(v) for k, v in p['attributes'].items()}
                if 'indices' in p: p['indices'] = copy(p['indices'])
            n1 = (accessors[p['indices']]['count'] if 'indices' in p else accessors[p['attributes']['POSITION']]['count']) // 3; after += n1
            if n1: prims.append(p)
        mesh['primitives'] = prims or mesh['primitives'][:1]
    j['accessors'] = accessors
    for im in j.get('images', []):
        v = old_views[im['bufferView']]; at = bin0 + v.get('byteOffset', 0); im['bufferView'] = view(b[at:at + v['byteLength']])
    while len(out) % 4: out.append(0)
    j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 28 + len(js) + len(out)
    open(dst, 'wb').write(b'glTF' + struct.pack('<III', 2, total, len(js)) + b'JSON' + js + struct.pack('<I', len(out)) + b'BIN\0' + bytes(out))
    print(f'{len(b) / 1e6:.1f} MB -> {total / 1e6:.2f} MB · triângulos {before} -> {after} · {len(j.get("images", []))} texturas')

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a not in ('--grid', '--opaque', '--flip', '--pbr') and not (sys.argv[sys.argv.index(a) - 1] == '--grid')]
    if len(args) != 2: sys.exit(__doc__)
    slim(args[0], args[1], int(sys.argv[sys.argv.index('--grid') + 1]) if '--grid' in sys.argv else 0, '--opaque' in sys.argv, '--flip' in sys.argv, '--pbr' in sys.argv)
