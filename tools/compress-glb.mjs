#!/usr/bin/env node
// Comprime a geometria de um .glb sem mudar a aparência:  node tools/compress-glb.mjs entrada.glb saida.glb [--merge]
//
// Mantém todos os triângulos e as texturas como estão. Os vértices são reordenados e gravados com a extensão
// EXT_meshopt_compression (o jogo descompacta ao carregar, ver parseModel em src/view/ships3d.ts). Posição, normal e UV
// continuam números de ponto flutuante, só com menos casas (BITS abaixo): o arredondamento é muito menor que um pixel.
// --merge: antes de comprimir, junta todas as peças de mesmo material numa malha só, já na posição final. Para modelos
// feitos de centenas de pecinhas (o boss tem 1680), em que a lista de peças pesa mais que a geometria. Só serve para
// naves e bases: apaga os nomes das peças, que armas e módulos usam (mount, glow...), e recusa arquivos com gun_N.
// É o ÚLTIMO passo: rode depois de tools/slim-glb.py, que não lê arquivos já comprimidos.
import { readFileSync, writeFileSync } from 'node:fs';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const BITS = {POSITION: 16, NORMAL: 12, TEXCOORD: 14}; // precisão guardada por atributo (TEXCOORD vale para todos os UVs)
const bitsOf = name => BITS[name.replace(/_\d+$/, '')];
const COMPS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}, SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const EXT = 'EXT_meshopt_compression';

// ---------- --merge: uma malha por material, com as transformações dos nós já aplicadas ----------
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const local = n => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
          2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
};
function merge(j, bin) {
  if (j.nodes.some(n => /^gun_?\d+$/i.test(n.name ?? ''))) throw new Error('--merge apagaria os marcadores gun_N deste arquivo');
  const f32 = (ai, comps) => { // accessor FLOAT -> Float32Array sem intervalos
    const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], stride = bv.byteStride || comps * 4, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    if (a.componentType !== 5126 || COMPS[a.type] !== comps) throw new Error('--merge espera posição, normal e UV em ponto flutuante');
    const dv = new DataView(bin.buffer, bin.byteOffset + base), out = new Float32Array(a.count * comps);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = dv.getFloat32(i * stride + k * 4, true);
    return out;
  };
  const u32 = ai => {
    const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], size = SIZE[a.componentType], stride = bv.byteStride || size, dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0));
    return Uint32Array.from({length: a.count}, (_, i) => size === 4 ? dv.getUint32(i * stride, true) : size === 2 ? dv.getUint16(i * stride, true) : dv.getUint8(i * stride));
  };
  const groups = new Map(); // material -> {pos, nor, uv, idx, n}
  const walk = (ni, parent) => {
    const n = j.nodes[ni], m = mul(parent, local(n));
    if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
      const names = Object.keys(p.attributes).sort().join();
      if ((p.mode ?? 4) !== 4 || p.indices === undefined || names !== 'NORMAL,POSITION,TEXCOORD_0') throw new Error('--merge espera triângulos indexados com POSITION, NORMAL e TEXCOORD_0; achou ' + names);
      const g = groups.get(p.material) ?? {pos: [], nor: [], uv: [], idx: [], n: 0}; groups.set(p.material, g);
      const pos = f32(p.attributes.POSITION, 3), nor = f32(p.attributes.NORMAL, 3), idx = u32(p.indices);
      // normais: pela inversa transposta da parte 3x3 (cofatores), para valer também com escala desigual
      const c = [m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8], m[2] * m[9] - m[1] * m[10], m[0] * m[10] - m[2] * m[8], m[1] * m[8] - m[0] * m[9],
                 m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4]];
      const det = m[0] * c[0] + m[1] * c[1] + m[2] * c[2], sg = det < 0 ? -1 : 1;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]], [a, b, d] = [nor[i], nor[i + 1], nor[i + 2]];
        g.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        const nx = (c[0] * a + c[3] * b + c[6] * d) * sg, ny = (c[1] * a + c[4] * b + c[7] * d) * sg, nz = (c[2] * a + c[5] * b + c[8] * d) * sg, l = Math.hypot(nx, ny, nz) || 1;
        g.nor.push(nx / l, ny / l, nz / l);
      }
      g.uv.push(...f32(p.attributes.TEXCOORD_0, 2));
      for (let i = 0; i < idx.length; i += 3) g.idx.push(g.n + idx[i], g.n + idx[i + (det < 0 ? 2 : 1)], g.n + idx[i + (det < 0 ? 1 : 2)]); // espelhado: inverte o sentido do triângulo
      g.n += pos.length / 3;
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // regrava: as imagens ficam onde estão no binário; a geometria nova vai depois delas
  const parts = [bin], views = j.bufferViews.filter((_, i) => j.images?.some(im => im.bufferView === i)), accessors = [];
  for (const im of j.images ?? []) im.bufferView = views.indexOf(j.bufferViews[im.bufferView]);
  let at = bin.length;
  const add = (arr, type, componentType, extra = {}) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - at % 4) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); at += pad; }
    views.push({buffer: 0, byteOffset: at, byteLength: bytes.length}); parts.push(bytes); at += bytes.length;
    return accessors.push({bufferView: views.length - 1, componentType, count: arr.length / COMPS[type], type, ...extra}) - 1;
  };
  j.meshes = [{primitives: [...groups].map(([material, g]) => {
    const pos = Float32Array.from(g.pos), min = [0, 1, 2].map(k => Infinity), max = [0, 1, 2].map(k => -Infinity);
    for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
    return {attributes: {POSITION: add(pos, 'VEC3', 5126, {min, max}), NORMAL: add(Float32Array.from(g.nor), 'VEC3', 5126), TEXCOORD_0: add(Float32Array.from(g.uv), 'VEC2', 5126)},
            indices: add(Uint32Array.from(g.idx), 'SCALAR', 5125), ...(material !== undefined && {material})};
  })}];
  j.nodes = [{mesh: 0}]; j.scenes = [{nodes: [0]}]; j.scene = 0; j.accessors = accessors; j.bufferViews = views;
  return concat(parts);
}

export async function compress(glb, merged = false) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength), jlen = dv.getUint32(12, true);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('não é um arquivo .glb');
  const j = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jlen)));
  let bin = glb.subarray(20 + jlen + 8);
  if (j.extensionsUsed?.includes(EXT)) throw new Error('já está comprimido');
  if (j.animations?.length || j.skins?.length) throw new Error('animações e esqueletos não são suportados');
  if (merged) bin = merge(j, bin);

  // bytes de um accessor, sem intervalos entre os elementos
  const raw = a => {
    const bv = j.bufferViews[a.bufferView], size = COMPS[a.type] * SIZE[a.componentType], stride = bv.byteStride || size;
    const out = new Uint8Array(a.count * size), base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++) out.set(bin.subarray(base + i * stride, base + i * stride + size), i * size);
    return out;
  };
  const chunks = [], views = []; let used = 0, fallback = 0; // buffer 0 (dados de verdade) e tamanho do buffer 1 (reserva)
  const put = bytes => { const at = used; chunks.push(bytes); used += bytes.length; const pad = (4 - used % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); used += pad; } return at; };
  // grava uma view comprimida e devolve o índice dela
  const view = (bytes, count, stride, mode, filter) => {
    const packed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    const v = {buffer: 1, byteOffset: fallback, byteLength: count * stride,
               extensions: {[EXT]: {buffer: 0, byteOffset: put(packed), byteLength: packed.length, byteStride: stride, count, mode, ...(filter && {filter})}}};
    if (mode === 'ATTRIBUTES') v.byteStride = stride;
    fallback += count * stride + (4 - count * stride % 4) % 4;
    return views.push(v) - 1;
  };

  // atributos compartilhados por primitivas com índices diferentes não podem ser reordenados (cada uma pediria uma ordem)
  const owners = new Map();
  for (const m of j.meshes) for (const p of m.primitives) for (const a of Object.values(p.attributes)) owners.set(a, (owners.get(a) ?? new Set()).add(p.indices ?? -1));
  const done = new Set(), accessors = j.accessors.map(a => ({...a}));
  for (const m of j.meshes) for (const p of m.primitives) {
    if ((p.mode ?? 4) !== 4) throw new Error('só triângulos são suportados');
    if (p.targets) throw new Error('morph targets não são suportados');
    const attrs = Object.entries(p.attributes), key = [p.indices ?? -1, ...attrs.map(e => e[1])].join();
    if (done.has(key)) continue; // mesma primitiva usada por outra malha
    if (attrs.some(e => done.has('a' + e[1])) || p.indices !== undefined && done.has('i' + p.indices)) throw new Error('accessors compartilhados entre primitivas diferentes não são suportados');
    done.add(key); for (const e of attrs) done.add('a' + e[1]); if (p.indices !== undefined) done.add('i' + p.indices);
    let count = j.accessors[attrs[0][1]].count, remap = null;
    if (p.indices !== undefined) {
      const ia = j.accessors[p.indices], ib = raw(ia), n = ia.count;
      const idx = new Uint32Array(n), rd = new DataView(ib.buffer);
      for (let i = 0; i < n; i++) idx[i] = ia.componentType === 5125 ? rd.getUint32(i * 4, true) : ia.componentType === 5123 ? rd.getUint16(i * 2, true) : ib[i];
      if (attrs.every(e => owners.get(e[1]).size === 1)) { let unique; [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, true); count = unique; }
      const wide = count > 65535, out = wide ? idx : Uint16Array.from(idx);
      accessors[p.indices] = {componentType: wide ? 5125 : 5123, count: n, type: 'SCALAR',
                              bufferView: view(new Uint8Array(out.buffer, out.byteOffset, out.byteLength), n, wide ? 4 : 2, 'TRIANGLES')};
    }
    for (const [name, ai] of attrs) {
      const a = j.accessors[ai], size = COMPS[a.type] * SIZE[a.componentType], stride = size + (4 - size % 4) % 4, src = raw(a);
      let data = new Uint8Array(count * stride);
      for (let i = 0; i < a.count; i++) { const to = remap ? remap[i] ?? 0xffffffff : i; if (to !== 0xffffffff) // vértice que nenhum triângulo usa: fica de fora
        data.set(src.subarray(i * size, i * size + size), to * stride); }
      let filter;
      if (bitsOf(name) && a.componentType === 5126) { // ponto flutuante com menos casas; continua FLOAT para o jogo
        const f = new Float32Array(data.buffer); let bits = bitsOf(name);
        if (name === 'POSITION') { // a precisão vale em relação ao tamanho da peça: se ela fica longe da origem, precisa de mais casas
          const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let far = 0;
          for (let i = 0; i < f.length; i++) { lo[i % 3] = Math.min(lo[i % 3], f[i]); hi[i % 3] = Math.max(hi[i % 3], f[i]); far = Math.max(far, Math.abs(f[i])); }
          const span = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
          bits = Math.min(24, bits + Math.max(0, Math.ceil(Math.log2(far / span))));
        }
        data = MeshoptEncoder.encodeFilterExp(f, count, stride, bits); filter = 'EXPONENTIAL';
      }
      const {sparse, byteOffset, ...rest} = a;
      if (sparse) throw new Error('accessors esparsos não são suportados');
      accessors[ai] = {...rest, count, bufferView: view(data, count, stride, 'ATTRIBUTES', filter)};
      if (name === 'POSITION') { // limites recalculados a partir do que o jogo vai ler depois de descompactar
        const v = views[accessors[ai].bufferView].extensions[EXT], back = new Uint8Array(count * stride);
        MeshoptDecoder.decodeGltfBuffer(back, count, stride, concat(chunks).subarray(v.byteOffset, v.byteOffset + v.byteLength), 'ATTRIBUTES', filter);
        const f = new Float32Array(back.buffer), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { const x = f[i * 3 + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; }
        accessors[ai].min = min; accessors[ai].max = max;
      }
    }
  }
  if (accessors.some((a, i) => a.bufferView === j.accessors[i].bufferView && j.accessors[i].bufferView !== undefined && !done.has('a' + i) && !done.has('i' + i))) throw new Error('há accessors fora das malhas');
  // imagens: copiadas como estão
  for (const im of j.images ?? []) if (im.bufferView !== undefined) {
    const bv = j.bufferViews[im.bufferView];
    im.bufferView = views.push({buffer: 0, byteOffset: put(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)), byteLength: bv.byteLength}) - 1;
  }
  j.accessors = accessors; j.bufferViews = views;
  j.buffers = [{byteLength: used}, {byteLength: fallback, extensions: {[EXT]: {fallback: true}}}];
  for (const k of ['extensionsUsed', 'extensionsRequired']) j[k] = [...new Set([...(j[k] ?? []), EXT])];
  let js = new TextEncoder().encode(JSON.stringify(j)); js = concat([js, new Uint8Array((4 - js.length % 4) % 4).fill(32)]);
  const head = new DataView(new ArrayBuffer(20)), bh = new DataView(new ArrayBuffer(8));
  head.setUint32(0, 0x46546c67, true); head.setUint32(4, 2, true); head.setUint32(8, 28 + js.length + used, true); head.setUint32(12, js.length, true); head.setUint32(16, 0x4e4f534a, true);
  bh.setUint32(0, used, true); bh.setUint32(4, 0x004e4942, true);
  return concat([new Uint8Array(head.buffer), js, new Uint8Array(bh.buffer), ...chunks]);
}
function concat(list) { const out = new Uint8Array(list.reduce((n, b) => n + b.length, 0)); let at = 0; for (const b of list) { out.set(b, at); at += b.length; } return out; }

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [src, dst] = process.argv.slice(2).filter(a => a !== '--merge');
  if (!src || !dst) { console.error('uso: node tools/compress-glb.mjs entrada.glb saida.glb'); process.exit(1); }
  const a = readFileSync(src), b = await compress(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), process.argv.includes('--merge'));
  writeFileSync(dst, b);
  console.log(`${(a.length / 1e6).toFixed(2)} MB -> ${(b.length / 1e6).toFixed(2)} MB`);
}
