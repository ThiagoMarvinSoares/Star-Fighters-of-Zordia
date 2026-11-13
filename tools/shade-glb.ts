// Imagem sombreada (sem textura) de um modelo como o jogo o carrega:  node tools/shade-glb.ts modelo.glb saida.png [tipo]
// tipo = como o jogo carrega o arquivo: ship (padrão), weapon, module ou base.
// Com um quinto argumento (chave da nave, ex.: scout), marca em vermelho os bocais (ENGINES) e em amarelo os pontos
// de tiro (HARD) dessa nave nos quadros de cima, de lado e por trás, para conferir se batem com o modelo.
// Serve para conferir forma e direção antes de pôr uma nave no jogo: a seta verde aponta para a frente do jogo.
// Quatro quadros: em cima, visto de cima (frente do jogo = direita) e em 3/4; embaixo, de lado (frente = direita)
// e por trás (direita da nave = direita). Em cima, de lado e por trás, 1 unidade do modelo = 193 px a partir do centro
// do quadro (cada quadro tem 420 px), o que permite ler posições, como a dos motores.
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseModel } from '../src/view/ships3d.ts';
import type { ModelKind } from '../src/view/ships3d.ts';
import { ENGINES, HARD } from '../src/game/models.ts';
import type { ModelKey } from '../src/game/data.ts';
Object.assign(globalThis, {self: globalThis, createImageBitmap: async () => ({width: 1, height: 1, close() {}})});
const buf = readFileSync(process.argv[2]);
const {object} = await parseModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, (process.argv[4] ?? 'ship') as ModelKind);
const fit = 2 / new THREE.Box3().setFromObject(object, true).getSize(new THREE.Vector3()).length(); if (fit > 1.5) object.scale.setScalar(fit); // itens pequenos (módulos) são ampliados para caber
object.updateMatrixWorld(true);
const N = 420, W = N * 2, HT = N * 2, px = new Uint8Array(W * HT * 3).fill(18), zb = new Float32Array(W * HT).fill(-Infinity);
const L = new THREE.Vector3(.4, .8, .45).normalize();
function view(ox: number, oy: number, m: THREE.Matrix4) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  object.traverse((o: any) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, ix = o.geometry.index, cnt = ix ? ix.count : p.count, mw = new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld);
    for (let i = 0; i < cnt; i += 3) {
      const g = (k: number) => ix ? ix.getX(i + k) : i + k;
      a.fromBufferAttribute(p, g(0)).applyMatrix4(mw); b.fromBufferAttribute(p, g(1)).applyMatrix4(mw); c.fromBufferAttribute(p, g(2)).applyMatrix4(mw);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const sh = Math.round(40 + 200 * Math.abs(n.dot(L)));
      const s = N * .46, X = (v: THREE.Vector3) => N / 2 + v.x * s, Y = (v: THREE.Vector3) => N / 2 - v.y * s;
      const x0 = Math.max(0, Math.floor(Math.min(X(a), X(b), X(c)))), x1 = Math.min(N - 1, Math.ceil(Math.max(X(a), X(b), X(c))));
      const y0 = Math.max(0, Math.floor(Math.min(Y(a), Y(b), Y(c)))), y1 = Math.min(N - 1, Math.ceil(Math.max(Y(a), Y(b), Y(c))));
      const d = (X(b) - X(a)) * (Y(c) - Y(a)) - (X(c) - X(a)) * (Y(b) - Y(a)); if (Math.abs(d) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w1 = ((x - X(a)) * (Y(c) - Y(a)) - (X(c) - X(a)) * (y - Y(a))) / d, w2 = ((X(b) - X(a)) * (y - Y(a)) - (x - X(a)) * (Y(b) - Y(a))) / d;
        if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
        const z = a.z + (b.z - a.z) * w1 + (c.z - a.z) * w2, k = (y + oy) * W + x + ox;
        if (z > zb[k]) { zb[k] = z; px[k * 3] = sh * .75; px[k * 3 + 1] = sh * .85; px[k * 3 + 2] = sh; }
      }
    }
  });
}
// de cima: tela x = frente do jogo (+x), tela y para cima = -z (esquerda da nave em cima), profundidade = +y
view(0, 0, new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
// 3/4: gira em torno de y e inclina
view(N, 0, new THREE.Matrix4().makeRotationX(.55).multiply(new THREE.Matrix4().makeRotationY(-.6)));
// de lado: tela x = frente, tela y = cima
view(0, N, new THREE.Matrix4());
// por trás: tela x = +z (direita da nave), tela y = cima, o mais perto é a traseira (-x)
view(N, N, new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
// linhas de centro (cinza) em cada quadro, para medir
for (const [ox, oy] of [[0, 0], [0, N], [N, N]]) for (let i = 0; i < N; i += 3) for (const k of [(oy + N / 2) * W + ox + i, (oy + i) * W + ox + N / 2]) if (zb[k] === -Infinity) px[k * 3] = px[k * 3 + 1] = px[k * 3 + 2] = 60;
// marcadores: quadrado de 7 px em cada quadro medido
const key = process.argv[5] as ModelKey | undefined;
if (key) for (const [list, col] of [[HARD[key], [255, 220, 40]], [ENGINES[key], [255, 50, 50]]] as const) for (const [x, y, z] of list) {
  const s = N * .46;
  for (const [cx, cy] of [[N / 2 + x * s, N / 2 + z * s], [N / 2 + x * s, N + N / 2 - y * s], [N + N / 2 + z * s, N + N / 2 - y * s]])
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const k = (Math.round(cy + dy) * W + Math.round(cx + dx)) * 3; if (k >= 0 && k < px.length) px.set(col, k); }
}
// seta verde no canto do painel de cima: aponta para a frente do jogo
for (let x = 20; x < 90; x++) for (let y = 18; y < 22; y++) { const k = (y * W + x) * 3; px[k] = 60; px[k + 1] = 255; px[k + 2] = 90; }
for (let t = 0; t < 14; t++) for (const s of [-1, 1]) for (let w = 0; w < 4; w++) { const k = ((20 + s * t + w) * W + 90 - t) * 3; px[k] = 60; px[k + 1] = 255; px[k + 2] = 90; }
const raw = Buffer.alloc((W * 3 + 1) * HT); for (let y = 0; y < HT; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4); const e = Buffer.alloc(4); e.writeUInt32BE(crc(Buffer.concat([h.subarray(4), d])), 0); return Buffer.concat([h, d, e]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(HT, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(process.argv[3], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
