// Confere que tools/compress-glb.mjs não mudou um modelo:  node tools/compare-glb.ts pastaAntes pastaDepois arquivo.glb...
// Compara triângulos, caixa exata, centro de massa, área total, UVs e normais; sai com erro se algum diferir.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
Object.assign(globalThis, {self: globalThis, createImageBitmap: async () => ({width: 1, height: 1, close() {}})});
const measure = async (f: string) => {
  const buf = readFileSync(f);
  const g: any = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  g.scene.updateMatrixWorld(true);
  let tris = 0, area = 0, uvsum = 0, nflip = 0; const c = new THREE.Vector3(), box = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), vn = new THREE.Vector3();
  g.scene.traverse((m: any) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position, ix = m.geometry.index, uv = m.geometry.attributes.uv, nr = m.geometry.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i += 3) {
      const [i0, i1, i2] = ix ? [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)] : [i, i + 1, i + 2];
      a.fromBufferAttribute(p, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, i1).applyMatrix4(m.matrixWorld); d.fromBufferAttribute(p, i2).applyMatrix4(m.matrixWorld);
      box.expandByPoint(a).expandByPoint(b).expandByPoint(d);
      n.crossVectors(b.clone().sub(a), d.clone().sub(a)); const ar = n.length() / 2; area += ar;
      c.addScaledVector(a.clone().add(b).add(d), ar / 3); tris++;
      if (nr && ar > 0) { vn.fromBufferAttribute(nr, i0).applyMatrix3(nm); if (vn.normalize().dot(n) < -.3 * n.length()) nflip++; } // normal do vértice contra a face
      if (uv) uvsum += uv.getX(i0) + uv.getY(i0) + uv.getX(i1) + uv.getY(i1) + uv.getX(i2) + uv.getY(i2);
    }
  });
  c.multiplyScalar(1 / area);
  return {tris, area, c: c.toArray(), min: box.min.toArray(), max: box.max.toArray(), uvsum, nflip, size: box.getSize(new THREE.Vector3()).length()};
};
let bad = 0;
for (const f of process.argv.slice(4)) {
  const x = await measure(`${process.argv[2]}/${f}`), y = await measure(`${process.argv[3]}/${f}`);
  const rel = (p: number, q: number) => Math.abs(p - q) / x.size;
  const dev = Math.max(...[0, 1, 2].flatMap(k => [rel(x.c[k], y.c[k]), rel(x.min[k], y.min[k]), rel(x.max[k], y.max[k])]));
  const ok = x.tris === y.tris && dev < 2e-4 && Math.abs(x.area - y.area) / x.area < 1e-3 && Math.abs(x.uvsum - y.uvsum) / (Math.abs(x.uvsum) || 1) < 1e-3 && Math.abs(x.nflip - y.nflip) <= x.tris * .002;
  if (!ok) bad++;
  console.log(ok ? 'igual  ' : 'DIFERE ', f.padEnd(26), 'tris', x.tris, y.tris, 'desvio', (dev * 100).toFixed(4) + '%', 'área', (Math.abs(x.area - y.area) / x.area * 100).toFixed(4) + '%', 'uv', (Math.abs(x.uvsum - y.uvsum) / (Math.abs(x.uvsum) || 1) * 100).toFixed(4) + '%', 'normais invertidas', x.nflip, y.nflip);
}
process.exit(bad ? 1 : 0);
