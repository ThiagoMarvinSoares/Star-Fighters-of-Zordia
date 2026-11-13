// Desenho: lê o estado e pinta o canvas. Nunca altera o estado do jogo.
// Tudo aqui é canvas 2D, menos as naves: elas são desenhadas em 3D por ships3d.ts e copiadas para cá.
import { RANGE, STATION_R, PORTAL_R, MISSILE_R, MINE_RANGE, MAPS, MODS, MODEL_DIR, ORES } from '../game/data.ts';
import type { Shot } from '../game/state.ts';
import { save, stats, cargoUsed, p, enemies, rocks, shots, texts, parts, events, view, map } from '../game/state.ts';
import type { Stats } from '../game/state.ts';
import { clamp } from '../game/util.ts';
import type { Point } from '../game/util.ts';
import { TILT, COSV, onScreen, minimap, ui } from './camera.ts';
import { SCALE } from '../game/models.ts';
import { createStage, hasModel } from './ships3d.ts';

// ---------- efeitos com imagens: public/fx/<nome>.png, do Particle Pack do Kenney ----------
// As imagens são brancas com transparência; cada uma é tingida uma vez por cor usada e guardada. Desenhe com a mistura
// 'lighter', para somar luz. Enquanto o arquivo não carrega, fx() devolve undefined e quem chama usa o traço antigo.
const FX = ['trace_06', 'star_07', 'scorch_02', 'circle_02', 'circle_05', 'spark_07', 'star_08']; // todas as imagens de efeito usadas abaixo
const fxImg = new Map<string, HTMLImageElement>(), fxTint = new Map<string, HTMLCanvasElement>();
function fx(name: string, color: string) {
  let c = fxTint.get(name + color);
  if (c) return c;
  let i = fxImg.get(name);
  if (!i) { i = new Image(); i.src = `fx/${name}.png`; fxImg.set(name, i); }
  if (!i.complete || !i.naturalWidth) return undefined;
  c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.drawImage(i, 0, 0, 128, 128); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  fxTint.set(name + color, c);
  return c;
}
/** carimba a imagem centrada em (x, y), com w x h (h = w se omitido), girada de rot */
function stamp(img: CanvasImageSource, x: number, y: number, w: number, rot = 0, alpha = 1, h = w) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alpha; ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
}
// clarões curtos (disparo, impacto), criados a partir dos eventos da simulação; x, y já em coordenadas de tela do mundo
interface Flash { x: number; y: number; t0: number; life: number; name: string; color: string; size: number; grow: number; rot: number }
const flashes: Flash[] = [];

// míssil em voo: o modelo 3D do próprio item (o mesmo do ícone)
const missileModel = (q: Shot) => q.missile && q.mod && MODS[q.mod].model ? `${MODEL_DIR.missile}/${MODS[q.mod].model}` : undefined;

const ctx = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
const stage = createStage(); // canvas WebGL das naves
const cv3w = () => Math.round(view.w * view.dpr), cv3h = () => Math.round(view.h * view.dpr); // a camada 3D, em pixels reais
// Inimigos que já passaram pela tela: só esses aparecem no minimapa, até serem destruídos. É memória do desenho, não
// estado do jogo (quem renasce é outro inimigo e volta a ficar oculto).
const seen = new WeakSet<object>();
// Fundo do mapa: fica "infinitamente longe", então não é inclinado e anda a só PARALLAX da câmera.
// uma imagem por arquivo de fundo, carregada na primeira vez que o mapa é desenhado
const bgs = new Map<string, HTMLImageElement>();
const bgOf = (file: string) => { let i = bgs.get(file); if (!i) { i = new Image(); i.src = 'bg/' + file; bgs.set(file, i); } return i; };
/** Carrega de antemão as imagens do desenho (fundo do mapa e efeitos), para nada aparecer aos poucos; tick a cada uma. */
export function preloadImages(bg: string, tick?: () => void) {
  const wait = (i: HTMLImageElement) => new Promise<void>(ok => { if (i.complete) ok(); else i.onload = i.onerror = () => ok(); }).then(tick);
  return Promise.all([wait(bgOf(bg)), ...FX.map(name => { fx(name, '#ffffff'); return wait(fxImg.get(name)!); })]);
}
/** quantas imagens preloadImages carrega */
export const IMAGES = 1 + FX.length;
const PARALLAX = .08;
const stars = Array.from({length: 250}, () => ({x: Math.random(), y: Math.random(), d: .1 + Math.random() * .5}));

function bar(x: number, y: number, w: number, h: number, frac: number, color: string) {
  ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}
// ---------- escudo: bolha com colmeia de hexágonos ----------
// As células são calculadas uma vez sobre meia esfera de raio 1 (por isso encolhem perto da borda, como numa bolha
// de verdade) e desenhadas uma a uma a cada quadro, para cada uma poder brilhar sozinha.
interface Cell { x: number; y: number; /** distância do centro, 0..1 */ d: number; pts: [number, number][] }
const CELLS: Cell[] = [];
{
  const s = .2, w = s * Math.sqrt(3); // lado e largura do hexágono, antes de curvar
  const ball = (x: number, y: number): [number, number] => { // ponto da grade plana -> ponto na meia esfera vista de frente
    const d = Math.hypot(x, y) || 1e-9, r = Math.sin(Math.min(d, 1) * Math.PI / 2);
    return [x / d * r, y / d * r];
  };
  for (let row = -5; row <= 5; row++) for (let col = -5; col <= 5; col++) {
    const x = (col + (row & 1) / 2) * w, y = row * 1.5 * s, d = Math.hypot(x, y);
    if (d > 1.05) continue;
    const [bx, by] = ball(x, y);
    CELLS.push({x: bx, y: by, d: Math.min(d, 1), pts: Array.from({length: 6}, (_, i) => {
      const t = Math.PI / 3 * i + Math.PI / 6; return ball(x + s * Math.cos(t), y + s * Math.sin(t));
    })});
  }
}
const RIPPLE = .7; // segundos que a onda de um impacto leva para atravessar a bolha e sumir
const ripples: { ang: number; t: number }[] = []; // impactos recentes no escudo do jogador

function shield(st: Stats, t: number) {
  for (const e of events) if (e.kind === 'hit' && e.onPlayer) ripples.push({ang: e.a + Math.PI, t}); // lado de onde o tiro veio
  while (ripples.length && t - ripples[0].t > RIPPLE) ripples.shift();
  if (p.sh <= 0) return;
  const R = st.r * SCALE * 1.2 * (1 + .012 * Math.sin(t * 2.3)), cy = p.y * TILT - st.r * .2, k = p.sh / st.maxSh; // R "respira"
  const a = (v: number) => st.aura + Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0'); // '#rrggbb' + transparência
  // corpo da bolha, quase transparente, e a borda; os dois enfraquecem conforme o escudo cai
  const g = ctx.createRadialGradient(p.x, cy - R * .25, R * .2, p.x, cy, R);
  g.addColorStop(0, a(0)); g.addColorStop(.7, a(.04 + .06 * k)); g.addColorStop(1, a(.14 + .18 * k));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = a(.2 + .3 * k); ctx.lineWidth = 1.5; ctx.stroke();
  // colmeia: gira devagar; uma faixa de luz varre a bolha; cada impacto acende as células em volta e se espalha em onda
  const rot = t * .12, c = Math.cos(rot), s = Math.sin(rot);
  ctx.save(); ctx.translate(p.x, cy); ctx.scale(R, R); ctx.rotate(rot);
  ctx.lineWidth = 1 / R; ctx.strokeStyle = ctx.fillStyle = st.aura;
  for (const q of CELLS) {
    const x = q.x * c - q.y * s, y = q.x * s + q.y * c; // onde a célula está na tela, já girada
    const band = Math.max(0, Math.sin(t * 1.4 - x * 2.2 - y * 1.3)) ** 10;
    let hit = 0;
    for (const r of ripples) {
      const age = t - r.t, far = Math.hypot(x - Math.cos(r.ang) * .8, y - Math.sin(r.ang) * .8); // distância até o ponto do impacto
      hit = Math.max(hit, Math.exp(-(((far - age * 2.4) / .22) ** 2)) * (1 - age / RIPPLE));
    }
    ctx.beginPath(); for (const [px, py] of q.pts) ctx.lineTo(px, py); ctx.closePath();
    if (hit > .05) { ctx.globalAlpha = Math.min(1, hit * .35); ctx.fill(); }
    ctx.globalAlpha = Math.min(1, (.03 + .1 * q.d * q.d + .22 * band) * (.4 + .6 * k) + hit); // parada: quase invisível no centro
    ctx.stroke();
  }
  ctx.restore(); ctx.lineWidth = 2;
}

// círculo no plano do mundo = elipse na tela
const ring = (o: Point, r: number, dy = 0) => { ctx.beginPath(); ctx.ellipse(o.x, o.y * TILT - dy, r, r * TILT, 0, 0, 7); };

// Partículas (chamas, explosões), em duas camadas em volta das naves 3D. A câmera olha de baixo da tela para cima:
// numa nave que desce a tela, a traseira fica do lado de lá do casco, então a chama dela vai por baixo (under); nas
// outras direções a traseira está à vista e a chama vai por cima, saindo do bocal. Explosões vão sempre por cima.
function drawParts(under: boolean) {
  ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 2;
  for (const q of parts) {
    if ((q.a !== undefined && Math.sin(q.a) > .25) !== under || !onScreen(q)) continue;
    const f = q.t / q.life;
    ctx.globalAlpha = f;
    if (q.ring) { ctx.strokeStyle = q.c; ring(q, q.r * (1 - f)); ctx.stroke(); }
    else { ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y * TILT - (q.h ?? 0) * COSV, q.r * (.4 + .6 * f), 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
export function draw() {
  const cw = view.w, ch = view.h, st = stats(), m = map(), W = m.w, H = m.h, BASE = m.base, bg = bgOf(m.bg);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // tudo abaixo desenha em pixels CSS
  ctx.fillStyle = '#03050c'; ctx.fillRect(0, 0, cw, ch);
  if (bg.complete && bg.naturalWidth) {
    // escala para cobrir a tela mais a folga que a paralaxe percorre de uma ponta à outra do mapa
    const mx = W * PARALLAX, my = H * TILT * PARALLAX;
    const s = Math.max((cw + mx) / bg.naturalWidth, (ch + my) / bg.naturalHeight);
    ctx.drawImage(bg, -p.x * PARALLAX, -p.y * TILT * PARALLAX, bg.naturalWidth * s, bg.naturalHeight * s);
  }
  ctx.fillStyle = '#89a';
  for (const s of stars) ctx.fillRect(((s.x * cw - p.x * s.d) % cw + cw) % cw, ((s.y * ch - p.y * TILT * s.d) % ch + ch) % ch, s.d * 3, s.d * 3);

  // ---------- mundo ----------
  const z = view.zoom, hw = cw / 2 / z, hh = ch / 2 / z; // zoom da câmera; hw x hh = metade da área do mundo que cabe na tela
  // Nomes de inimigos e asteroides: sempre do mesmo tamanho na tela (13 px vezes o tamanho da interface), por mais longe
  // que a câmera esteja. Como são desenhados dentro do mundo, que encolhe com o zoom, a fonte cresce na mesma medida.
  const nameFont = `${13 * ui.scale / z}px monospace`, nameGap = 13 * ui.scale / z;
  ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(z, z); ctx.translate(-p.x, -p.y * TILT);
  // grade do plano (dá a noção de inclinação)
  const G = 250, x0 = Math.max(0, p.x - hw), x1 = Math.min(W, p.x + hw), y0 = Math.max(0, p.y - hh / TILT), y1 = Math.min(H, p.y + hh / TILT);
  ctx.strokeStyle = 'rgba(90,140,200,.13)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = Math.ceil(x0 / G) * G; x <= x1; x += G) { ctx.moveTo(x, y0 * TILT); ctx.lineTo(x, y1 * TILT); }
  for (let y = Math.ceil(y0 / G) * G; y <= y1; y += G) { ctx.moveTo(x0, y * TILT); ctx.lineTo(x1, y * TILT); }
  ctx.stroke();
  ctx.strokeStyle = '#345'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, W, H * TILT);
  // base
  ctx.textAlign = 'center'; ctx.font = '14px monospace';
  if (BASE) {
    const fight = p.fight > 0; // em combate a zona não protege: a borda fica laranja e avisa
    ctx.strokeStyle = fight ? '#d73' : '#2a6'; ctx.setLineDash([8, 8]); ring(BASE, BASE.r); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = fight ? '#fb8' : '#9fc'; ctx.fillText(fight ? `BASE (em combate: sem proteção por ${Math.ceil(p.fight)}s)` : 'BASE (zona segura)', BASE.x, (BASE.y + BASE.r) * TILT - 10);
  }
  // portais: dois anéis no chão (o de dentro pulsa) e o nome do mapa de destino
  for (const g of m.portals) {
    const k = .5 + .5 * Math.sin(performance.now() / 300);
    ctx.strokeStyle = '#b98cff'; ctx.lineWidth = 3; ring(g, PORTAL_R); ctx.stroke();
    ctx.globalAlpha = .35 + .5 * k; ring(g, PORTAL_R * (.45 + .2 * k)); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.fillStyle = '#d9c4ff'; ctx.fillText('Portal: ' + MAPS[g.to].name, g.x, (g.y + PORTAL_R) * TILT + 18);
  }

  drawParts(true); // chamas de quem voa em direção à câmera: atrás do casco
  // naves: anéis de alcance e de alvo por baixo, a camada 3D, e por cima escudo, barras e nomes
  if (p.target) {
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ring(p, RANGE); ctx.stroke();
    ctx.strokeStyle = '#f33'; ring(p.target, p.target.t.r * SCALE + 8); ctx.stroke();
    ctx.strokeStyle = '#ff7ad9'; ctx.setLineDash([6, 5]); // alvos extras do chip de múltiplos alvos: anel tracejado
    for (const e of p.extra) { ring(e, e.t.r * SCALE + 8); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const vis = enemies.filter(e => onScreen(e, Math.max(60, e.t.r * 2)));
  for (const e of vis) seen.add(e);
  // asteroides na tela: giram devagar (só no desenho); o escolhido para minerar ganha um anel na cor do minério
  const stones = rocks.filter(k => onScreen(k, k.r * 2)), spin = performance.now() / 9000;
  for (const k of stones) {
    seen.add(k);
    const model = 'asteroids/' + ORES[k.ore].model;
    if (!hasModel(model)) { ctx.fillStyle = '#556'; ctx.beginPath(); ctx.ellipse(k.x, k.y * TILT, k.r * SCALE, k.r * SCALE * .8, 0, 0, 7); ctx.fill(); } // até o .glb chegar
    if (k === p.mining) { ctx.strokeStyle = ORES[k.ore].color; ring(k, k.r * SCALE + 10); ctx.stroke(); }
  }
  stage.render([...(BASE ? [{id: BASE, o: {x: BASE.x, y: BASE.y, a: 0}, r: STATION_R, key: 'station' as const}] : []), // a estação da base, parada
                ...vis.map(e => ({id: e, o: e, r: e.t.r, key: e.t.key})),
                ...stones.map(k => ({id: k, o: {x: k.x, y: k.y, a: k.a + spin}, r: k.r, model: 'asteroids/' + ORES[k.ore].model})),
                {id: p, o: p, r: st.r, key: save.ship},
                ...shots.flatMap(q => { const model = q.live && onScreen(q) && missileModel(q); return model ? [{id: q, o: q, r: MISSILE_R, model, h: q.h}] : []; })],
               p, cw / z, ch / z, cv3w(), cv3h());
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(stage.canvas, 0, 0); ctx.restore(); // pixel a pixel, sem escala
  drawParts(false); // explosões e as chamas de quem não está de costas para a câmera: por cima das naves
  shield(st, performance.now() / 1000);
  for (const e of vis) { // embaixo de cada inimigo: escudo, vida e nome
    const ly = e.y * TILT + e.t.r + 10;
    bar(e.x - 25, ly, 50, 4, e.sh / e.t.sh, '#4cf');
    bar(e.x - 25, ly + 5, 50, 4, e.hp / e.t.hp, '#4d4');
    ctx.font = nameFont; ctx.fillStyle = e.t.color; ctx.fillText(e.t.name, e.x, ly + 10 + nameGap);
  }
  // asteroides: nome do minério e quanto resta; feixe de mineração, tremido, da nave até o asteroide
  ctx.font = nameFont;
  for (const k of stones) { // quando o minerador equipado não alcança o minério, o nome diz qual é preciso
    const o = ORES[k.ore], need = st.mineLevel < o.level ? ` · exige Mk${o.level}` : '';
    ctx.fillStyle = o.color; ctx.fillText(`${o.name} ${Math.ceil(k.left)}${need}`, k.x, k.y * TILT + k.r * SCALE + 4 + nameGap);
  }
  if (p.beam && p.mining) {
    const k = p.mining, t = performance.now() / 60, col = ORES[k.ore].color;
    const arc = fx('spark_07', col), dot = fx('circle_05', col), star = fx('star_08', '#ffffff');
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = col; ctx.lineCap = 'round';
    if (arc && dot && star) { // coletor: raio elétrico da nave ao asteroide, grãos de minério correndo até a nave e uma faísca no ponto de contato
      const ax = k.x, ay = k.y * TILT, dx = p.x - ax, dy = p.y * TILT - ay, L = Math.hypot(dx, dy) || 1, rot = Math.atan2(dy, dx);
      ctx.lineWidth = 2; ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(p.x, p.y * TILT); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(ax + dx / 2, ay + dy / 2); ctx.rotate(rot); ctx.scale(1, Math.floor(t / 1.2) % 2 ? 1 : -1); // vira de lado ~14x por segundo: tremor
      ctx.globalAlpha = .7 + .3 * Math.sin(t); ctx.drawImage(arc, -L / 1.8, -26, L / .9, 52); ctx.restore();
      for (let i = 0; i < 7; i++) { // grãos: do asteroide para a nave, ondulando de leve
        const f = (t / 15 + i / 7) % 1, wob = Math.sin(f * 9 + i * 2) * 7;
        stamp(dot, ax + dx * f - dy / L * wob, ay + dy * f + dx / L * wob, 16 - 7 * f, 0, Math.sin(Math.PI * f));
      }
      stamp(star, ax, ay, 44 + 10 * Math.sin(t / 2), t / 20, .9); stamp(dot, ax, ay, 60, 0, .5);
    } else for (const [w, a] of [[7, .25], [2.5, .9]]) { // sem as imagens: halo largo e fio fino por cima
      ctx.lineWidth = w; ctx.globalAlpha = a * (.8 + .2 * Math.sin(t));
      ctx.beginPath(); ctx.moveTo(p.x, p.y * TILT); ctx.lineTo(k.x + Math.sin(t * 1.7) * 3, k.y * TILT + Math.cos(t * 1.3) * 3); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 2;
  }
  ctx.font = '14px monospace';

  // clarões novos deste quadro: estrela na boca do canhão a cada disparo; no impacto, anel azul se o escudo segurou,
  // estouro claro se pegou no casco
  const nowMs = performance.now();
  for (const e of events) {
    if (e.kind === 'shot') flashes.push({x: e.x, y: e.y * TILT - e.h * COSV, t0: nowMs, life: 90, name: 'star_07', color: e.c, size: 30, grow: .4, rot: 0});
    else if (e.kind === 'hit') flashes.push({x: e.at.x, y: e.at.y * TILT - e.at.h * COSV, t0: nowMs, life: e.shielded ? 220 : 160, name: e.shielded ? 'circle_02' : 'scorch_02',
                                             color: e.shielded ? '#7fd4ff' : '#ffe0b0', size: e.shielded ? 26 : 34, grow: e.shielded ? 1.3 : .5, rot: Math.random() * 6.28});
  }
  // tiros
  ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const q of shots) if (q.live) {
    const model = missileModel(q);
    if (model && hasModel(model)) continue; // míssil com modelo carregado: já foi desenhado em 3D (sem ele, vale o traço)
    const y = q.y * TILT - q.h * COSV - 2;
    const bolt = !q.missile && fx('trace_06', q.c), core = bolt && fx('trace_06', '#ffffff');
    if (bolt && core) { // laser: cápsula de luz na cor do tiro com miolo branco, alinhada à direção em que ele voa na tela
      const rot = Math.atan2(Math.sin(q.a) * TILT, Math.cos(q.a)) + Math.PI / 2, bx = q.x - Math.cos(q.a) * 10, by = y - Math.sin(q.a) * 10 * TILT;
      stamp(bolt, bx, by, 34, rot, 1, 78); stamp(core, bx, by, 16, rot, .9, 60);
      continue;
    }
    const len = q.missile ? 22 : 16; ctx.lineWidth = q.missile ? 6 : 3; // míssil: traço mais grosso e comprido
    ctx.strokeStyle = q.c; ctx.beginPath(); ctx.moveTo(q.x - Math.cos(q.a) * len, y - Math.sin(q.a) * len * TILT); ctx.lineTo(q.x, y); ctx.stroke();
  }
  for (let i = flashes.length; i--;) { // clarões: crescem e somem
    const f = flashes[i], age = (nowMs - f.t0) / f.life, img = age < 1 && fx(f.name, f.color);
    if (age >= 1) { flashes.splice(i, 1); continue; }
    if (img) stamp(img, f.x, f.y, f.size * (1 + f.grow * age), f.rot, 1 - age);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 2;
  for (const t of texts) { ctx.fillStyle = t.c; ctx.fillText(t.s, t.x, t.y * TILT - 10); }
  ctx.restore();

  // ---------- HUD desenhada no canvas: dica dos controles e minimapa (os painéis do jogador e do alvo ficam em hud.ts) ----------
  // Tudo aqui é desenhado nas medidas de uma tela 1x e ampliado por ui.scale, como os painéis em HTML.
  const u = ui.scale, mm = minimap();
  ctx.save(); ctx.scale(u, u);
  ctx.textAlign = 'left'; ctx.fillStyle = '#789'; ctx.font = '12px monospace';
  ['Clique: mover / travar alvo / minerar', 'Roda do mouse: zoom   + e -: tamanho da interface', '1 ou ESPAÇO: canhões   2: mísseis   T: mira automática', 'B: inventário   F: fps']
    .forEach((line, i, all) => ctx.fillText(line, 12, ch / u - 12 - (all.length - 1 - i) * 16)); // canto inferior esquerdo, em linhas curtas
  ctx.restore();
  ctx.font = '14px monospace';
  // minimapa: a origem vai para o canto dele e a escala para u; daqui em diante ox, oy, mw, mh e mk são da tela 1x
  ctx.save(); ctx.translate(mm.x, mm.y); ctx.scale(u, u);
  const ox = 0, oy = 0, mw = mm.w / u, mh = mm.h / u, mk = mm.k / u; // mk = escala mundo -> minimapa
  ctx.fillStyle = 'rgba(10,20,40,.8)'; ctx.fillRect(ox, oy, mw, mh); ctx.strokeStyle = '#357'; ctx.strokeRect(ox, oy, mw, mh);
  if (BASE) { ctx.fillStyle = '#2a6'; ctx.fillRect(ox + BASE.x * mk - 3, oy + BASE.y * mk - 3, 6, 6); }
  for (const k of rocks) if (seen.has(k)) { ctx.fillStyle = ORES[k.ore].color; ctx.fillRect(ox + k.x * mk - 1, oy + k.y * mk - 1, 3, 3); } // asteroides já vistos
  // porão, acima do minimapa: aparece quando há minerador ou carga
  const used = cargoUsed();
  if (st.mine || used >= 1) { ctx.fillStyle = used >= st.cargo - 1e-9 ? '#fa4' : '#9fc'; ctx.textAlign = 'right'; ctx.font = '12px monospace'; ctx.fillText(`Porão ${Math.floor(used)}/${st.cargo}`, ox + mw, oy - 8); ctx.textAlign = 'left'; ctx.font = '14px monospace'; }
  ctx.fillStyle = '#b98cff'; for (const g of m.portals) ctx.fillRect(ox + g.x * mk - 2, oy + g.y * mk - 2, 5, 5);
  for (const e of enemies) if (seen.has(e)) { ctx.fillStyle = e.t.color; const s = e.t.r > 50 ? 3 : 1; ctx.fillRect(ox + e.x * mk - s, oy + e.y * mk - s, s * 2, s * 2); } // o chefe aparece maior
  if (Math.hypot(p.tx - p.x, p.ty - p.y) > 40) { // rota até o destino (clique no mundo ou no próprio minimapa)
    ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox + p.x * mk, oy + p.y * mk); ctx.lineTo(ox + p.tx * mk, oy + p.ty * mk); ctx.stroke();
    ctx.strokeRect(ox + p.tx * mk - 2, oy + p.ty * mk - 2, 4, 4); ctx.lineWidth = 2;
  }
  ctx.fillStyle = '#fff'; ctx.fillRect(ox + p.x * mk - 2, oy + p.y * mk - 2, 4, 4);
  ctx.restore();
}
