// Naves em 3D de verdade (three.js). Um "palco" é um canvas WebGL transparente com câmera sem perspectiva
// na mesma inclinação do jogo; quem usa copia esse canvas para o seu canvas 2D com drawImage.
// Mundo do jogo (x, y) -> three (x, 0, z = y); a altura é o eixo Y do three.
// Os modelos vêm de arquivos .glb em public/models/; sem arquivo, vale o modelo escrito em models.ts.
import * as THREE from 'three';
import type { ModelKey } from '../game/data.ts';
import type { Point } from '../game/util.ts';
import { TILT, COSV } from './camera.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HARD, SCALE } from '../game/models.ts';
import type { Vec3 } from '../game/models.ts';

/** uma nave a desenhar: id identifica a mesma nave entre quadros (o próprio objeto do inimigo/jogador) */
/** Algo a desenhar em 3D: uma nave (key) ou um item da biblioteca voando, como um míssil (model = 'missiles/missil1').
 *  r = raio (o modelo mede 3r de comprimento); h = altura acima do plano. */
export interface ShipView { id: object; o: Point & { a: number }; r: number; key?: ModelKey; model?: string; h?: number }

const LIT = new THREE.MeshLambertMaterial({vertexColors: true});
const GLOW = new THREE.MeshBasicMaterial({vertexColors: true}); // motores, olhos: cor cheia, sem sombra

// Substituto de qualquer modelo enquanto o .glb dele não chega: um casco genérico, pontudo na frente (+X), medindo 2.
const PLACEHOLDER = new THREE.Mesh(new THREE.ConeGeometry(.45, 2, 5).rotateZ(-Math.PI / 2).scale(1, .45, 1), new THREE.MeshLambertMaterial({color: 0x4a5a70}));

// ---------- biblioteca de modelos: public/models/<pasta>/<nome>.glb ----------
// Pastas: ships (naves), weapons, shields, engines, aim e missiles (lasers, escudos, motores, miras e mísseis: só
// viram ícone no hangar e na barra de atalhos),
// bases (a estação da base).
// O que o jogo espera de um arquivo:
//  - nave: +Y para cima e frente em +Z (padrão glTF). Tamanho e centro são ajustados sozinhos. Objetos vazios
//    chamados gun_1, gun_2... marcam onde ficam as armas.
//  - arma: qualquer orientação. O cano é o lado mais comprido; o encaixe (onde ela apoia e gira) é a peça com
//    "mount" no nome, e "para cima" é o lado oposto a ele. Sem essa peça: +Y para cima e a origem como encaixe.
//  - módulo (escudo, motor): qualquer orientação; "para cima" é o lado oposto à peça com "mount" no nome (sem ela, +Y).
//  - base: achatada (o lado mais curto é a altura), com o chão de pouso na altura zero do arquivo.
//  - asteroide (pasta asteroids): qualquer orientação; é centrado e a maior medida vira 2.
//  - materiais viram foscos, mais leves (cor, textura e brilho próprio são mantidos), menos nos arquivos que trazem
//    textura de relevo ou de metal: esses ficam com o material completo e refletem o ambiente da cena. Nos foscos, cor, textura e
//    brilho próprio são mantidos. Em modelos só com cor por vértice, peças com glow, light, illuminated, reticle, emitter, energy,
//    beacon, window ou track no nome brilham.
export type ModelKind = 'ship' | 'weapon' | 'module' | 'base' | 'rock';
const KIND: Record<string, ModelKind> = {ships: 'ship', weapons: 'weapon', shields: 'module', engines: 'module', aim: 'module', missiles: 'module', chips: 'module', asteroids: 'rock', bases: 'base'}; // pasta -> tipo
// modelos que não ficam em ships/<chave>.glb
const PATH: Partial<Record<ModelKey, string>> = {station: 'bases/base_anel'};
// bases grossas, que esconderiam as naves ao cruzar: ficam inteiras abaixo do plano de voo e as naves passam por cima
export const SUNK = new Set(['bases/base_anel']);
const LEN: Record<ModelKind, number> = {ship: 2, weapon: .46, module: .2, base: 2, rock: 2}; // maior medida horizontal, na escala da nave
type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

/** Encaixa uma cena carregada nas convenções do jogo (frente em +X, +Y para cima, tamanho LEN) e acha os pontos gun_N. */
export function adopt(scene: THREE.Object3D, kind: ModelKind, sunk = false) {
  const matte = new Map<THREE.Material, THREE.Material>();
  scene.traverse(n => {
    if (!(n instanceof THREE.Mesh)) return;
    const g: THREE.BufferGeometry = n.geometry, m = n.material as THREE.MeshStandardMaterial;
    if (!g.hasAttribute('normal')) { n.geometry = g.toNonIndexed(); n.geometry.computeVertexNormals(); } // faces planas
    if (g.hasAttribute('color') && !m.map) n.material = /glow|light|illuminated|reticle|emitter|energy|beacon|window|track/i.test(n.name) ? GLOW : LIT;
    else {
      let t = matte.get(m);
      if (!t && (m.normalMap || m.roughnessMap || m.metalnessMap)) {
        // acabamento completo: o arquivo veio com relevo ou metal (tools/slim-glb.py --pbr, naves do jogador); o material
        // do arquivo fica como está, só com o brilho próprio limitado. O reflexo vem do ambiente da cena (ver lit).
        m.emissiveIntensity = Math.min(m.emissiveIntensity, 2);
        matte.set(m, t = m);
      }
      if (!t) {
        matte.set(m, t = new THREE.MeshLambertMaterial({color: m.color, map: m.map, transparent: m.transparent, opacity: m.opacity, side: m.side}));
        // brilho próprio limitado: sem o tratamento de imagem dos programas 3D, um valor alto (alguns arquivos pedem 7x) vira branco chapado
        if (m.emissive) Object.assign(t, {emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: Math.min(m.emissiveIntensity, 2)});
      }
      n.material = t;
    }
  });
  // medida exata (vértice a vértice): em modelos com muitas peças giradas, a caixa aproximada sai maior que o modelo
  const box = new THREE.Box3().setFromObject(scene, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group(), object = new THREE.Group();
  if (kind === 'ship' || kind === 'rock') {
    scene.position.sub(c);
    pivot.rotation.y = Math.PI / 2; // frente do glTF (+Z) -> frente do jogo (+X)
    // nave: mede 2 no plano; asteroide: a maior das três medidas vale 2 (não tem frente nem "em pé")
    pivot.scale.setScalar(LEN[kind] / (Math.max(size.x, size.z, kind === 'rock' ? size.y : 0) || 1));
  } else {
    // encaixe: peças com "mount" no nome (menos as do cano, tipo "barrel mounting clamp")
    const mb = new THREE.Box3();
    scene.traverse(n => { if (/mount/i.test(n.name) && !/barrel/i.test(n.name)) mb.expandByObject(n); });
    const mc = mb.isEmpty() ? null : mb.getCenter(new THREE.Vector3());
    const low = (a: Axis) => mc ? (mc[a] - c[a]) / (size[a] || 1) : 0; // quão abaixo do centro o encaixe está nesse eixo
    const lowest = (l: Axis[]) => l.reduce((a, b) => low(b) < low(a) ? b : a), longest = (l: Axis[]) => l.reduce((a, b) => size[b] > size[a] ? b : a);
    let f: Axis, u: Axis, at: THREE.Vector3; // eixos do arquivo que viram frente e cima, e o ponto que vai para a origem
    if (kind === 'base') {   // estação: é achatada, então "cima" é o lado mais curto. Centralizada; fica na altura em que foi
      u = AXES.reduce((a, b) => size[b] < size[a] ? b : a); // modelada ou, se sunk, inteira abaixo do plano de voo
      f = longest(AXES.filter(a => a !== u));
      at = c.clone(); at[u] = sunk ? box.max[u] : 0;
    } else if (kind === 'weapon') { // o cano manda: é o eixo mais comprido; "cima" sai dos outros dois
      f = longest(AXES);
      u = mc ? lowest(AXES.filter(a => a !== f)) : f === 'y' ? 'z' : 'y';
      at = mc ? mc.clone() : new THREE.Vector3(); // encaixe (ou a origem do arquivo) na origem...
      at[u] = (mc ? mb : box).min[u];             // ...com a base apoiada na altura do ponto de fixação
    } else {                 // caixa sem frente óbvia: o encaixe manda; "frente" é o lado mais comprido que sobrar
      u = mc ? lowest(AXES) : 'y';
      f = longest(AXES.filter(a => a !== u));
      at = (mc ?? c).clone(); at[u] = (mc ? mb : box).min[u];
    }
    scene.position.sub(at);
    // arma: o cano aponta para o lado que se afasta mais do encaixe. Gira para frente = +X e cima = +Y
    const fv = new THREE.Vector3(), uv = new THREE.Vector3();
    fv[f] = box.max[f] - at[f] >= at[f] - box.min[f] ? 1 : -1; uv[u] = 1;
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fv, uv, fv.clone().cross(uv)).transpose());
    pivot.scale.setScalar(LEN[kind] / (size[f] || 1));
  }
  pivot.add(scene); object.add(pivot); object.updateMatrixWorld(true);
  const guns: Vec3[] = [];
  scene.traverse(n => { const m = /^gun_?(\d+)$/i.exec(n.name); if (m) guns[+m[1] - 1] = n.getWorldPosition(new THREE.Vector3()).toArray(); });
  // Junta todas as peças de mesmo material numa malha só (um modelo de 150 peças vira 2 chamadas de desenho).
  // Se as peças não combinarem entre si, fica como veio.
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse(n => { if (n instanceof THREE.Mesh) meshes.push(n); });
  const indexed = meshes.every(n => n.geometry.index); // só dá para juntar se todas forem do mesmo jeito
  for (const n of meshes) {
    const g: THREE.BufferGeometry = indexed || !n.geometry.index ? n.geometry.clone() : n.geometry.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!/^(position|normal|color|uv\d?)$/.test(k)) g.deleteAttribute(k);
    const list = groups.get(n.material as THREE.Material) ?? []; groups.set(n.material as THREE.Material, list);
    list.push(g.applyMatrix4(n.matrixWorld));
  }
  const merged = [...groups].map(([m, l]) => { const g = mergeGeometries(l); return g && new THREE.Mesh(g, m); });
  if (merged.length && merged.every(Boolean)) { object.remove(pivot); object.add(...merged as THREE.Mesh[]); }
  return {object, guns};
}
/** Lê o conteúdo de um arquivo .glb e devolve o modelo já encaixado. */
export const parseModel = async (glb: ArrayBuffer, kind: ModelKind, basePath = '', sunk = false) =>
  // os modelos maiores vêm com a geometria comprimida (tools/compress-glb.mjs); o decodificador a abre ao carregar
  adopt((await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb, basePath)).scene, kind, sunk);

// Um molde por modelo; as naves na tela são clones (dividem geometria e material).
// Começa com o substituto genérico (PLACEHOLDER) e troca pelo .glb quando (e se) o arquivo carregar.
const cache = new Map<string, THREE.Object3D>(), jobs = new Map<string, Promise<void>>(), loaded = new Set<string>();
const listeners: (() => void)[] = [];
const icons = new Map<string, string>(); // fotos dos modelos (data URL), refeitas quando o .glb chega
let version = 0; // sobe a cada .glb carregado: as naves já na tela são refeitas com o modelo novo
function template(path: string) {
  let t = cache.get(path);
  if (!t) { cache.set(path, t = PLACEHOLDER); request(path); }
  return t;
}
// pede o .glb de um modelo (uma vez só); a promessa termina quando ele carregou ou falhou, nunca rejeita
function request(path: string) { let j = jobs.get(path); if (!j) jobs.set(path, j = load(path)); return j; }
/** onde fica o .glb de uma nave, inimigo ou estação, dentro de public/models */
export const pathOf = (key: ModelKey) => PATH[key] ?? `ships/${key}`;
/** Carrega de antemão os modelos pedidos (tela de carregamento); tick é chamado a cada um que termina. */
export const preload = (paths: string[], tick?: () => void) => Promise.all(paths.map(q => request(q).then(tick)));
/** troca o molde de um modelo (ex.: 'weapons/mp1'); as naves na tela são refeitas com ele */
export function install(path: string, object: THREE.Object3D) {
  cache.set(path, object); loaded.add(path); icons.delete(path); version++;
  for (const f of listeners) f();
}
/** avisa sempre que um .glb termina de carregar (o hangar usa para mostrar o ícone que acabou de ficar pronto) */
export const onModelLoaded = (f: () => void) => { listeners.push(f); };
async function load(path: string) {
  if (typeof document === 'undefined') return; // fora do navegador (testes) só existem os modelos em código
  try {
    const url = `models/${path}.glb`, res = await fetch(url);
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return; // arquivo ainda não existe
    const [kind, key] = path.split('/');
    const {object, guns} = await parseModel(await res.arrayBuffer(), KIND[kind], url.slice(0, url.lastIndexOf('/') + 1), SUNK.has(path));
    // a nave nova diz onde ficam as armas; a simulação usa os mesmos pontos para o tiro sair do lugar certo
    if (kind === 'ships') guns.forEach((g, i) => { if (i < HARD[key as ModelKey].length) HARD[key as ModelKey][i] = g; });
    install(path, object);
  } catch (e) { console.warn(`modelo ${path}.glb ignorado:`, e); }
}

// mesma luz do renderizador antigo: 30% ambiente + 70% vindo de cima/esquerda (x PI: unidades físicas do three)
function lit(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const sun = new THREE.DirectionalLight(0xffffff, .7 * Math.PI);
  sun.position.set(-.47, .78, .41);
  // ambiente para os materiais completos (naves do jogador) terem o que refletir: sem isso, metal sai preto.
  // É uma sala clara genérica, borrada; os materiais foscos não são afetados.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .6;
  pmrem.dispose();
  return scene.add(new THREE.AmbientLight(0xffffff, .3 * Math.PI), sun);
}

// ---------- ícones: cada modelo da biblioteca é "fotografado" uma vez, de três quartos, para o hangar ----------
let photo: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera } | undefined;
/** Giro para a foto de um módulo (escudo, motor): vira para a câmera o lado onde ficam as partes acesas (o anel
 *  emissor, o bocal), um pouco de lado. Sem partes acesas, usa o três quartos padrão. */
export function iconYaw(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()), lit = new THREE.Vector3(), b = new THREE.Box3(), v = new THREE.Vector3();
  o.traverse(n => {
    const m = n instanceof THREE.Mesh ? n.material as THREE.Material & { emissive?: THREE.Color } : null;
    if (!m || !(m === GLOW || m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > .3)) return;
    b.setFromObject(n); lit.add(b.getCenter(v).sub(c).multiplyScalar(b.getSize(new THREE.Vector3()).length())); // peças maiores pesam mais
  });
  // As luzes nunca ficam bem no meio da face (um anel deslocado, uma faixa de status), o que deixaria cada modelo
  // num ângulo um pouco diferente. Vale só a face onde elas estão: o eixo dominante.
  if (Math.abs(lit.x) > Math.abs(lit.z)) lit.z = 0; else lit.x = 0;
  // lado aceso (ângulo no plano do chão) -> apontando para a câmera, 35 graus para a esquerda
  return Math.hypot(lit.x, lit.z) < 1e-6 ? -.7 : Math.atan2(lit.z, lit.x) - (Math.PI / 2 + .6);
}
/** Ícone (data URL) de um modelo, ex.: iconOf('shields/shield1'). Devolve undefined enquanto o .glb não
 *  carregou ou se não existe; com placeholder, fotografa o substituto genérico até o .glb chegar (naves). */
export function iconOf(path: string, placeholder = false, px = 256) {
  if (placeholder) template(path); else request(path);
  if (!placeholder && !loaded.has(path)) return undefined;
  let url = icons.get(path);
  if (!url) {
    if (!photo) {
      const renderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
      photo = {renderer, scene: lit(new THREE.Scene(), renderer), cam: new THREE.OrthographicCamera()};
      photo.renderer.setSize(px, px, false);
    }
    const o = cache.get(path)!.clone();
    o.rotation.y = KIND[path.split('/')[0]] === 'module' ? iconYaw(o) : -.7;
    const box = new THREE.Box3().setFromObject(o), side = box.getSize(new THREE.Vector3()).length() * 1.05;
    o.position.sub(box.getCenter(new THREE.Vector3())); // centro do modelo no ponto para onde a câmera olha
    photo.scene.add(o); aimCamera(photo.cam, {x: 0, y: 0}, side, side);
    photo.renderer.render(photo.scene, photo.cam);
    icons.set(path, url = photo.renderer.domElement.toDataURL());
    photo.scene.remove(o);
  }
  return url;
}

/** nave pronta para a cena (o equipamento não aparece nela: só o casco) */
export function shipObject(key: ModelKey) {
  const g = template(pathOf(key)).clone();
  g.userData = {key, version};
  return g;
}
/** Item da biblioteca (míssil, asteroide...) pronto para a cena, na escala das naves (comprimento 2, frente em +X). Enquanto o .glb não carrega, vem vazio: quem chama desenha outra coisa no lugar (ver hasModel). */
export function modelObject(path: string) {
  const g = new THREE.Group(), t = cache.get(path);
  if (t && loaded.has(path)) { const c = t.clone(); c.scale.setScalar(LEN.ship / LEN[KIND[path.split('/')[0]]]); g.add(c); } else request(path);
  g.userData = {key: path, version};
  return g;
}
/** o .glb deste item da biblioteca já carregou? */
export const hasModel = (path: string) => loaded.has(path);
/** posiciona a nave no mundo */
export function pose(g: THREE.Object3D, s: ShipView) {
  g.position.set(s.o.x, s.h ?? 0, s.o.y); g.rotation.y = -s.o.a; g.scale.setScalar(s.r * SCALE);
}
/** câmera sem perspectiva olhando para center, inclinada como o jogo: w x h unidades do mundo cabem na tela */
export function aimCamera(cam: THREE.OrthographicCamera, center: Point, w: number, h: number) {
  cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2; cam.near = 1; cam.far = 6000;
  cam.position.set(center.x, TILT * 3000, center.y + COSV * 3000); cam.lookAt(center.x, 0, center.y);
  cam.updateProjectionMatrix();
}

export function createStage() {
  const renderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
  renderer.setPixelRatio(1);
  const scene = lit(new THREE.Scene(), renderer), cam = new THREE.OrthographicCamera();
  const live = new Map<object, THREE.Object3D>();
  let pw = 0, ph = 0;
  return {
    canvas: renderer.domElement,
    /** desenha as naves vistas de center; w x h = área do mundo mostrada, pxW x pxH = tamanho do canvas em pixels */
    render(ships: ShipView[], center: Point, w: number, h: number, pxW = w, pxH = h) {
      if (pxW !== pw || pxH !== ph) renderer.setSize(pw = pxW, ph = pxH, false);
      aimCamera(cam, center, w, h);
      const seen = new Set<object>();
      for (const s of ships) {
        let g = live.get(s.id);
        if (!g || g.userData.key !== (s.model ?? s.key) || g.userData.version !== version) { // nave nova, trocou de modelo, ou chegou um .glb
          if (g) scene.remove(g);
          live.set(s.id, g = s.model ? modelObject(s.model) : shipObject(s.key!)); scene.add(g);
        }
        seen.add(s.id); pose(g, s);
      }
      for (const [id, g] of live) if (!seen.has(id)) { scene.remove(g); live.delete(id); } // saiu da tela ou morreu
      renderer.render(scene, cam);
    },
  };
}
