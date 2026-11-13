# Uso: python3 tools/montar-star-sparrow.py kit-original.glb montada.glb  (depois: tools/slim-glb.py montada.glb public/models/ships/corvette.glb)
# Monta a nave do kit "Star Sparrow": aplica a cada peça a posição do último quadro da animação, tira as peças
# escondidas nesse quadro e troca as armas do kit por marcadores gun_N (o jogo monta ali os lasers equipados).
import sys, struct, json
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
clen, = struct.unpack('<I', b[12:16]); j = json.loads(b[20:20 + clen]); bin0 = 20 + clen + 8; acc = j['accessors']
def read(ai):
    a = acc[ai]; v = j['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    o = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0); st = v.get('byteStride') or 4 * n
    return [struct.unpack('<%df' % n, b[o + i * st:o + i * st + 4 * n]) for i in range(a['count'])]
an = j['animations'][0]
for ch in an['channels']:
    node = j['nodes'][ch['target']['node']]; node.pop('matrix', None)
    node[ch['target']['path']] = list(read(an['samplers'][ch['sampler']]['output'])[-1])  # valor do último quadro
del j['animations']
hidden = {i for i, n in enumerate(j['nodes']) if n.get('name', '').startswith('StarSparrow') and abs(n.get('scale', [1])[0]) < .05}
weapons = [i for i, n in enumerate(j['nodes']) if 'Weapon' in n.get('name', '') and i not in hidden]
weapons.sort(key=lambda i: (abs(j['nodes'][i]['translation'][0]), j['nodes'][i]['translation'][0]))  # de dentro para fora, alternando os lados
for k, i in enumerate(weapons):
    n = j['nodes'][i]; print('arma do kit ->', f'gun_{k + 1}', n['name'], [round(x, 2) for x in n['translation']])
    j['nodes'][i] = {'name': f'gun_{k + 1}', 'translation': n['translation']}
for n in j['nodes']:
    if 'children' in n: n['children'] = [c for c in n['children'] if c not in hidden]
kept = [n['name'].replace('StarSparrow_', '') for i, n in enumerate(j['nodes']) if n.get('name', '').startswith('StarSparrow') and i not in hidden]
print('peças na nave:', ' '.join(kept))
js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
rest = b[bin0 - 8:]
open(dst, 'wb').write(b'glTF' + struct.pack('<III', 2, 20 + len(js) + len(rest), len(js)) + b'JSON' + js + rest)
