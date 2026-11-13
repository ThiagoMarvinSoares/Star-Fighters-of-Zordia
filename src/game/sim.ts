// Simulação: as regras do jogo. Só altera o estado; não sabe nada de canvas, tela nem teclado.
import { RANGE, SHOT_SPEED, MISSILE_CHARGES, MISSILE_CD, MISSILE_SPEED, MISSILE_R, KEEP_MARGIN, CLEAR, LEASH, COMBAT, PORTAL_R, PICKUP_R, BOSS_DROP, MINE_RANGE, ROCK_ORE, MODS, ORES, MAPS, HOME } from './data.ts';
import type { EnemyDef, MapDef, MapKey } from './data.ts';
import type { ModelKey, ModKey } from './data.ts';
import { save, persist, stats, cargoUsed, p, enemies, rocks, drops, shots, texts, parts, events, world, map } from './state.ts';
import type { Body, Enemy, Player, Rock } from './state.ts';
import { clamp, dist, rnd, rand } from './util.ts';
import type { Point } from './util.ts';
import { HARD, ENGINES, SCALE, mount } from './models.ts';

type Heading = Point & { a: number };

let now = 0; // relógio do jogo, em segundos
const bossAt: Partial<Record<MapKey, number>> = {}; // quando o chefe de cada mapa (re)nasce; lembrado mesmo fora do mapa
let seeded = false; // o mapa atual já recebeu a população inicial

/** raio em volta da base do mapa atual onde inimigos não entram (0 se o mapa não tem base) */
export const keepOut = () => { const b = map().base; return b ? b.r + KEEP_MARGIN : 0; };
/** Troca de mapa: a nave aparece em (x, y) de to. O mapa que ficou para trás é descartado (ao voltar, é repovoado). */
export function travel(to: MapKey, x: number, y: number) {
  world.map = to; seeded = false;
  enemies.length = rocks.length = drops.length = shots.length = parts.length = texts.length = 0; // espólio deixado para trás se perde
  Object.assign(p, {x, y, tx: x, ty: y, target: null, mining: null, beam: false});
}

/** Retoma de onde o progresso parou (ao abrir o jogo ou entrar com um piloto): a nave volta ao mapa, ao ponto, à vida e ao
 *  escudo do último salvamento, e os chefes destruídos continuam fora até a hora de cada um. Sem nada salvo, não muda nada. */
export function resume() {
  for (const k of Object.keys(MAPS) as MapKey[]) bossAt[k] = now + Math.max(0, ((save.boss?.[k] ?? 0) - Date.now()) / 1000);
  const q = save.pos, m = q && MAPS[q.map];
  if (!q || !m) return;
  travel(q.map, clamp(q.x, 0, m.w), clamp(q.y, 0, m.h));
  const st = stats(); p.hp = clamp(q.hp, 1, st.maxHp); p.sh = clamp(q.sh, 0, st.maxSh);
}

export const float = (o: Point, s: string, c: string, t = 1) => texts.push({x: o.x + rnd(-15, 15), y: o.y - 20, s, c, t});

// escudo absorve primeiro; retorna true se destruiu
export function hit(e: Pick<Body, 'hp' | 'sh' | 'lastHit'>, d: number) {
  const a = Math.min(e.sh, d);
  e.sh -= a; e.hp -= d - a; e.lastHit = now;
  return e.hp <= 0;
}

function step(o: Heading, gx: number, gy: number, s: number) {
  const dx = gx - o.x, dy = gy - o.y, d = Math.hypot(dx, dy);
  if (d > 4) { const m = Math.min(d, s); o.x += dx / d * m; o.y += dy / d * m; o.a = Math.atan2(dy, dx); }
  return d > 4; // moveu?
}

// Passo de um inimigo em direção a (gx, gy) sem entrar na área da base (raio keepOut()): se o caminho reto
// cruzaria a área, ele contorna pela borda, pelo lado mais curto, em vez de empurrar contra ela.
function approach(e: Enemy, gx: number, gy: number, s: number) {
  const BASE = map().base, KEEP_OUT = keepOut();
  if (!BASE) return step(e, gx, gy, s); // mapa sem base: caminho livre
  const rx = e.x - BASE.x, ry = e.y - BASE.y, rd = Math.hypot(rx, ry) || 1;
  if (rd < KEEP_OUT + 2 && (gx - e.x) * rx + (gy - e.y) * ry < 0) { // encostado na borda e querendo entrar
    const side = (gx - e.x) * -ry + (gy - e.y) * rx >= 0 ? 1 : -1;  // para que lado da borda o destino está
    gx = e.x - ry / rd * side * 100; gy = e.y + rx / rd * side * 100;
  }
  const moved = step(e, gx, gy, s), bd = dist(e, BASE);
  if (bd < KEEP_OUT) { e.x = BASE.x + (e.x - BASE.x) / (bd || 1) * KEEP_OUT; e.y = BASE.y + (e.y - BASE.y) / (bd || 1) * KEEP_OUT; }
  return moved;
}

// ---------- partículas: chama do motor e explosões ----------
// uma partícula de chama saindo do ponto at, para trás de quem aponta para a; size = raio dela, h = altura acima do plano
function flame(at: Point, a: number, size: number, c: string, h = 0) {
  const cx = Math.cos(a), sy = Math.sin(a), j = size * .4;
  parts.push({x: at.x + rnd(-j, j), y: at.y + rnd(-j, j), vx: -cx * 60 + rnd(-15, 15), vy: -sy * 60 + rnd(-15, 15), t: .3, life: .3, r: size, c, h, a});
}
// chama dos motores de uma nave: uma partícula por bocal do modelo (ENGINES), saindo de lá. Sem bocal, sem chama
// (alienígenas orgânicos). k < 1 = chama menor. Quanto mais bocais, menor cada chama, para o total não crescer.
const LANE = 44; // distância entre a faixa de voo do míssil da esquerda e a do da direita
const FLAME = .25; // raio da chama em relação ao raio da nave (com um bocal só)
function thrust(o: Heading, r: number, key: ModelKey, c: string, k = 1) {
  const noz = ENGINES[key];
  for (const e of noz) flame(mount(o, r, e), o.a, r * FLAME * k / Math.sqrt(noz.length), c, e[1] * r * SCALE);
}
export function explode(o: Point, r: number) {
  for (let i = 0; i < 14 + r; i++) {
    const a = rnd(0, 6.28), v = rnd(20, 60 + r * 6), life = rnd(.4, 1);
    parts.push({x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: life, life, r: rnd(r * .2, r * .6), c: ['#fff', '#fd4', '#f84', '#f44'][i % 4]});
  }
  parts.push({x: o.x, y: o.y, vx: 0, vy: 0, t: .5, life: .5, r: r * 4, c: '#fff', ring: true}); // onda de choque
  events.push({kind: 'boom', x: o.x, y: o.y, r});
}

const born = (t: EnemyDef, x: number, y: number): Enemy => ({t, x, y, wx: x, wy: y, hx: x, hy: y, back: false, a: 0, hp: t.hp, sh: t.sh, cd: 0, lastHit: -99, hostile: false});
// Sorteia com pick() um ponto que passe em ok() e fique a pelo menos far do jogador. Em mapa pequeno pode não existir
// ponto tão longe: depois de 40 candidatos válidos fica o mais distante deles, em vez de sortear para sempre. (Contam os
// válidos, não os sorteios: numa faixa em que a maior parte dos pontos cai fora do mapa, 40 sorteios eram poucos e às
// vezes um inimigo renascia perto do jogador mesmo havendo lugar longe.)
function place(pick: () => Point, ok: (q: Point) => boolean, far: number): Point {
  let best: Point | undefined, bd = -1;
  for (let i = 0, valid = 0; i < 400 && valid < 40; i++) {
    const q = pick();
    if (!ok(q)) continue;
    valid++;
    const d = dist(q, p);
    if (d >= far) return q;
    if (d > bd) { best = q; bd = d; }
  }
  return best ?? pick();
}
// asteroide novo: fora da base e dos portais; os de reposição (away) nascem longe do jogador, como os inimigos.
// Quanto mais longe da base, mais valioso o minério (mesma regra de distância dos inimigos).
function rock0(away: boolean): Rock {
  const m = map(), o = m.base ?? m.spawn, gap = m.base ? m.base.r + 150 : 0;
  const {x, y} = place(() => ({x: rnd(100, m.w - 100), y: rnd(100, m.h - 100)}),
                       q => dist(q, o) >= gap && !m.portals.some(g => dist(q, g) < PORTAL_R + 150), away ? CLEAR : 250);
  const far = clamp((dist({x, y}, o) / Math.hypot(m.w, m.h) - .1) / .6, 0, 1);
  const ore = m.ores[clamp(Math.round(far * (m.ores.length - 1) + rnd(-.6, .4)), 0, m.ores.length - 1)];
  return {ore, x, y, a: rnd(0, 6.28), r: rnd(28, 44), left: Math.round(rnd(ROCK_ORE[0], ROCK_ORE[1]))};
}
// ---------- população: cada tipo de inimigo na sua faixa ----------
// O mapa é dividido em faixas de distância a partir da base (ou do ponto de chegada, sem base), uma por tipo de inimigo:
// o mais fraco na primeira, o mais forte na última. Cada tipo tem uma cota fixa (MapDef.mix) e nasce só na faixa dele,
// e quem morre é reposto por outro do mesmo tipo. Assim a área perto da base sempre volta a ter inimigos fracos, e a
// proporção entre fracos e fortes não muda com o tempo.
const quotaOf = new Map<MapDef, number[]>();
/** quantos de cada tipo o mapa mantém: population repartida conforme mix, somando exatamente population */
function quotas(m: MapDef) {
  let q = quotaOf.get(m);
  if (!q) {
    const mix = m.enemies.map((_, i) => m.mix?.[i] ?? 1), total = mix.reduce((a, b) => a + b, 0), exact = mix.map(w => w / total * m.population);
    q = exact.map(Math.floor);
    for (const i of exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).map(v => v[1]).slice(0, m.population - q.reduce((a, b) => a + b, 0))) q[i]++;
    quotaOf.set(m, q);
  }
  return q;
}
/** faixa do tipo i: [de, até], em distância a partir da base. A primeira começa logo fora da base; a última vai até o fim. */
function band(m: MapDef, i: number): [number, number] {
  const n = m.enemies.length, diag = Math.hypot(m.w, m.h), gap = m.base ? m.base.r + 300 : 0;
  const at = (k: number) => (clamp(k / Math.max(1, n - 1), 0, 1) * .62 + .14) * diag; // distância onde a faixa k "centra"
  return [i === 0 ? gap : Math.max(gap, at(i - .5)), i === n - 1 ? diag : at(i + .5)];
}
// um inimigo do tipo i, num ponto da faixa dele. away = reposição de um destruído: nasce longe do jogador (a população
// inicial só evita nascer em cima dele, senão o começo ficaria vazio)
function spawn(i: number, away: boolean): Enemy {
  const m = map(), o = m.base ?? m.spawn, [r0, r1] = band(m, i);
  const {x, y} = place(() => { const r = rnd(r0, r1), a = rnd(0, 6.2832); return {x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r}; },
                       q => q.x >= 0 && q.x <= m.w && q.y >= 0 && q.y <= m.h, away ? CLEAR : 600);
  return born(m.enemies[i], x, y);
}

// dispara o tiro i da nave src (modelo key), saindo do ponto de fixação i, depois de delay segundos
const shoot = (src: Player | Enemy, r: number, key: ModelKey, i: number, tgt: Player | Enemy, dmg: number, c: string, delay: number, mod?: ModKey, miss = false, missile = false, lane = 0) => {
  const a = rnd(0, 6.28), m = ('t' in tgt ? tgt.t.r : 20) * 1.5 + rnd(25, 60); // quem erra passa ao lado do alvo, fora do casco
  shots.push({src, r, hard: HARD[key][i % HARD[key].length], tgt, dmg, c, delay, mod, live: false, x: 0, y: 0, a: 0, h: 0, missile, lane,
              off: miss ? {x: Math.cos(a) * m, y: Math.sin(a) * m} : undefined});
};

export function update(dt: number) {
  events.length = 0; // eventos valem por um quadro
  now += dt;
  const st = stats();
  const moved = step(p, p.tx, p.ty, st.speed * dt); // vira a nave para onde ela vai; se estiver atacando, a mira corrige abaixo
  const m = map(), base = m.base, boss = m.boss;
  p.x = clamp(p.x, 0, m.w); p.y = clamp(p.y, 0, m.h);
  // portal: encostou, mudou de mapa; o resto do quadro não vale mais (o mapa novo é povoado no próximo)
  for (const g of m.portals) if (dist(p, g) < PORTAL_R) { travel(g.to, g.tx, g.ty); return; }

  // Zona segura: dentro da base e fora de combate. Quem atirou ou levou dano há menos de COMBAT segundos continua em
  // combate mesmo dentro da base: os inimigos seguem atirando e a cura rápida não liga.
  p.fight = Math.max(0, COMBAT - (now - Math.max(p.lastHit, p.lastShot)));
  const inBase = !!base && dist(p, base) < base.r, safe = inBase && p.fight <= 0;
  // De dentro da base o jogador nunca atira, nem em combate. Os inimigos não entram na faixa em volta dela e os lasers
  // do jogador alcançam mais longe que os deles: atirando lá de dentro dava para acertar um inimigo preso na borda, sem
  // ele conseguir chegar nem responder.
  // Inimigo que desiste da luta volta inteiro: sem isso dava para ferir, fugir, curar e voltar até vencer qualquer um.
  // O chefe é a exceção: a luta contra ele é feita em várias investidas, e a vida dele fica entre uma e outra.
  const calm = (e: Enemy) => { if (e.hostile) { e.hostile = false; if (!boss || e.t !== boss.def) { e.hp = e.t.hp; e.sh = e.t.sh; } } };
  if (safe) enemies.forEach(calm); // o jogador ficou a salvo: quem o perseguia desiste
  if (now - p.lastHit > 5) p.sh = Math.min(st.maxSh, p.sh + st.maxSh * .08 * dt);
  // a vida só se recupera a salvo na base; fora dela, só o escudo volta (acima)
  if (safe) p.hp = Math.min(st.maxHp, p.hp + st.maxHp * .2 * dt);

  // ---------- armas do jogador ----------
  p.cd -= dt;
  // mira automática: sem alvo ao alcance, trava o inimigo mais próximo que estiver dentro do alcance
  if (p.auto && !inBase && !(p.target && dist(p, p.target) <= RANGE)) {
    let best = RANGE;
    for (const e of enemies) { const d = dist(p, e); if (d <= best) { best = d; p.target = e; } }
  }
  const t = p.target;
  p.extra = [];
  if (t) {
    const td = dist(p, t);
    if (td > 1500) p.target = null;
    // atacando (lasers liberados e alvo ao alcance): o bico da nave aponta para o alvo, mesmo voando para outro lado
    else if (!inBase && (p.firing || p.auto) && td <= RANGE && st.dmg) p.a = Math.atan2(t.y - p.y, t.x - p.x);
    // Múltiplos alvos (chip equipado e ligado na barra): além do alvo travado, até st.multi inimigos ao alcance, primeiro
    // os que já estão atacando o jogador, depois os mais próximos. Fica em p.extra para o desenho marcar.
    if (p.target && p.multi && st.multi && !inBase && td <= RANGE)
      p.extra = enemies.filter(e => e !== t && dist(p, e) <= RANGE).sort((a, b) => +b.hostile - +a.hostile || dist(p, a) - dist(p, b)).slice(0, st.multi);
    if (p.target && !inBase && (p.firing || p.auto) && td <= RANGE && p.cd <= 0 && st.dmg) {
      p.cd = 1; p.lastShot = now;
      // um tiro por módulo de laser, cada um saindo do seu ponto de fixação e com o dano do seu módulo; com múltiplos
      // alvos, os lasers se revezam entre eles (o laser 0 no principal, o 1 no primeiro extra, e assim por diante)
      const tgts = [t, ...p.extra];
      for (const e of tgts) e.hostile = true;
      save.mods.filter(m => MODS[m].type === 'laser').forEach((m, i, l) =>
        shoot(p, st.r, save.ship, i, tgts[i % tgts.length], Math.round(MODS[m].val * st.boost * rnd(.85, 1.15)), '#4cf', i / l.length, m, rand() >= st.acc));
    }
  }

  // a chama sai dos bocais na posição final da nave (depois de ela virar para o alvo) e tem a cor do motor equipado
  if (moved) thrust(p, st.r, save.ship, st.flame);

  // espólio: passar por cima recolhe para o inventário
  for (let i = drops.length; i--;) if (dist(p, drops[i]) < PICKUP_R) {
    const [d] = drops.splice(i, 1);
    save.inv.push(d.item); persist(); float(p, MODS[d.item].name + ' recolhido', '#fa4', 3);
  }

  // ---------- mineração ----------
  // O feixe liga sozinho quando o asteroide escolhido (clique) está ao alcance, há minerador e sobra espaço no porão.
  // Longe demais, a escolha continua valendo: a nave pode estar a caminho. O progresso é salvo quando o feixe desliga.
  const was = p.beam, rock = p.mining;
  p.beam = false;
  if (rock) {
    const free = st.cargo - cargoUsed();
    if (!rocks.includes(rock)) p.mining = null;
    else if (!st.mine) { p.mining = null; float(p, 'Sem minerador equipado', '#fa4', 2); }
    else if (st.mineLevel < ORES[rock.ore].level) { p.mining = null; float(p, `${ORES[rock.ore].name} exige Minerador Mk${ORES[rock.ore].level}`, '#fa4', 2.5); }
    else if (free <= 1e-9) { p.mining = null; float(p, 'Porão cheio', '#fa4', 2); }
    else if (dist(p, rock) <= MINE_RANGE) {
      const got = Math.min(st.mine / ORES[rock.ore].hard * dt, rock.left, free); // minério mais duro sai mais devagar
      rock.left -= got; save.cargo[rock.ore] += got; p.beam = true;
      if (rock.left <= 1e-9) { // esgotou: o asteroide se desfaz (outro nasce longe dali, mais abaixo)
        rocks.splice(rocks.indexOf(rock), 1); p.mining = null; p.beam = false;
        explode(rock, rock.r * .5); float(rock, ORES[rock.ore].name + ' esgotada', ORES[rock.ore].color, 1.5);
      }
    }
  }
  if (was && !p.beam) persist();

  // ---------- mísseis ----------
  // Cada míssil equipado é independente: tem as MISSILE_CHARGES cargas dele. A recarga devolve uma carga por vez e dura
  // sempre MISSILE_CD segundos inteiros, contados do último lançamento daquele míssil: lançar de novo reinicia a contagem.
  // Um aperto na casa dele (barra de atalhos) lança uma carga contra o alvo travado, alternando o lado da nave: esquerda,
  // direita. Erram como os lasers.
  const ms = save.mods.filter(m => MODS[m].type === 'missile'); // na ordem da nave: o míssil j é a casa j dos mísseis
  while (p.mis.length < ms.length) p.mis.push({n: MISSILE_CHARGES, t: 0}); // módulo recém-equipado: cargas prontas
  p.mis.length = ms.length;
  for (const c of p.mis) if (c.n < MISSILE_CHARGES && (c.t -= dt) <= 0) { c.n++; c.t = c.n < MISSILE_CHARGES ? MISSILE_CD : 0; }
  if (p.launch !== null) {
    const m = ms[p.launch], c = p.mis[p.launch];
    p.launch = null;
    if (m && c && c.n > 0 && t && p.target === t && !inBase && dist(p, t) <= RANGE) {
      const left = p.mleft;
      c.n--; c.t = MISSILE_CD; p.mleft = !left; t.hostile = true; p.lastShot = now;
      // ponto de fixação 1 = lado esquerdo da nave, 0 = direito (os pares de HARD são espelhados); a faixa de voo
      // acompanha o lado, para dois mísseis seguidos irem lado a lado e não em fila
      shoot(p, st.r, save.ship, left ? 1 : 0, t, Math.round(MODS[m].val * st.boost), '#fa4', 0, m, rand() >= st.acc, true, (left ? -1 : 1) * LANE / 2);
    }
  }

  // ---------- IA dos inimigos ----------
  for (const e of enemies) {
    const ed = dist(e, p);
    // perdeu o jogador de vista, ou foi longe demais de casa: desiste. Longe de casa ele ainda volta (back) sem dar
    // atenção ao jogador, até estar de novo bem dentro do território dele.
    const dh = Math.hypot(e.x - e.hx, e.y - e.hy);
    if (dh > LEASH) { calm(e); e.back = true; e.wx = e.hx; e.wy = e.hy; }
    else if (dh < LEASH * (e.hostile ? .85 : .5)) e.back = false; // atacado no caminho de volta, reage mais cedo
    if (ed > 1400) calm(e);
    if (now - e.lastHit > 6) e.sh = Math.min(e.t.sh, e.sh + e.t.sh * .05 * dt);
    e.cd -= dt;
    if (!safe && !e.back && (e.hostile || e.t.aggro && ed < Math.max(450, e.t.range ?? 0))) {
      if (ed <= 280) e.a = Math.atan2(p.y - e.y, p.x - e.x);
      else if (approach(e, p.x, p.y, e.t.speed * dt)) thrust(e, e.t.r, e.t.key, e.t.color);
      if (ed < (e.t.range ?? 500) && e.cd <= 0) {
        e.cd = 1.3;
        const n = HARD[e.t.key].length;
        for (let i = 0; i < n; i++) shoot(e, e.t.r, e.t.key, i, p, Math.round(e.t.dmg / n), e.t.color, i / n * 1.3);
      }
    } else {
      if (Math.hypot(e.wx - e.x, e.wy - e.y) < 10) { // chegou: sorteia outro ponto para vagar, fora da área da base
        // vaga em volta de casa, nunca a partir de onde está: senão, de ponto em ponto, ia parar em qualquer lugar do mapa
        // No máximo 40 sorteios por quadro, como em place(): se a casa estiver tão perto da base que nenhum ponto em volta
        // dela serve, ele fica onde está e tenta de novo no quadro seguinte, em vez de sortear para sempre e travar o jogo.
        for (let i = 0; i < 40; i++) {
          const q = {x: clamp(e.hx + rnd(-400, 400), 0, m.w), y: clamp(e.hy + rnd(-400, 400), 0, m.h)};
          if (!base || dist(q, base) >= keepOut() + 50) { e.wx = q.x; e.wy = q.y; break; }
        }
      }
      // vagando: devagar e com chama menor; voltando para casa: na velocidade normal
      if (approach(e, e.wx, e.wy, e.t.speed * (e.back ? 1 : .4) * dt)) thrust(e, e.t.r, e.t.key, e.t.color, e.back ? 1 : .6);
    }
  }

  // ---------- tiros em voo ----------
  for (let i = shots.length; i--;) {
    const q = shots[i];
    if ((q.delay -= dt) > 0) continue;
    if (q.tgt.hp <= 0 || !q.live && q.src.hp <= 0) { shots.splice(i, 1); continue; } // alvo ou atirador já morreu
    if (!q.live) { // nasce no ponto de fixação, na posição/rotação atual da nave
      const at = mount(q.src, q.r, q.hard);
      q.x = at.x; q.y = at.y; q.h = q.hard[1] * q.r * SCALE; q.live = true;
      events.push({kind: 'shot', x: q.x, y: q.y, h: q.h, c: q.c, mine: q.src === p, mod: q.mod});
    }
    let dx = q.tgt.x + (q.off?.x ?? 0) - q.x, dy = q.tgt.y + (q.off?.y ?? 0) - q.y;
    const d = Math.hypot(dx, dy), m = (q.missile ? MISSILE_SPEED : SHOT_SPEED) * dt;
    if (q.lane && d > 1) { // mira num ponto ao lado do alvo, cada vez mais perto dele: a faixa se fecha na chegada
      const side = q.lane * Math.min(1, d / 260);
      const ax = dx - dy / d * side, ay = dy + dx / d * side, al = Math.hypot(ax, ay) || 1;
      dx = ax / al * d; dy = ay / al * d;
    }
    q.a = Math.atan2(dy, dx);
    if (q.missile) { // rastro: sai da cauda do modelo (o centro dele fica na posição do tiro), na altura em que ele voa
      const tail = MISSILE_R * SCALE;
      flame({x: q.x - Math.cos(q.a) * tail, y: q.y - Math.sin(q.a) * tail}, q.a, 1.3, q.c, q.h + 3);
    }
    if (d > m) { q.x += dx / d * m; q.y += dy / d * m; continue; }
    shots.splice(i, 1);
    if (q.off) { float(q, 'Miss', '#9ab'); continue; }
    const tg = q.tgt;
    float(tg, '-' + q.dmg, q.c);
    if (q.missile) explode(q, 6);
    events.push({kind: 'hit', x: tg.x, y: tg.y, at: {x: q.x, y: q.y, h: q.h}, a: q.a, onPlayer: tg === p, shielded: tg.sh > 0});
    parts.push({x: tg.x + rnd(-8, 8), y: tg.y + rnd(-8, 8), vx: 0, vy: 0, t: .15, life: .15, r: 7, c: q.c}); // faísca do impacto
    if (hit(tg, q.dmg) && 't' in tg) { // inimigo destruído (a morte do jogador é tratada logo abaixo)
      enemies.splice(enemies.indexOf(tg), 1); if (p.target === tg) p.target = null; explode(tg, tg.t.r);
      if (boss && tg.t === boss.def) { // o chefe deixa o espólio dele, e a hora de voltar fica salva com o progresso
        bossAt[world.map] = now + boss.respawn; save.boss = {...save.boss, [world.map]: Date.now() + boss.respawn * 1000};
        drops.push({x: tg.x, y: tg.y, item: BOSS_DROP});
      }
      save.credits += tg.t.reward; persist();
      float(tg, '+' + tg.t.reward + ' cr', '#fd4', 1.5);
    }
  }

  // ---------- morte do jogador ----------
  if (p.hp <= 0) {
    explode(p, st.r); shots.length = 0;
    const SPAWN = MAPS[HOME].spawn; // renasce sempre na base do mapa inicial, esteja onde estiver
    if (world.map !== HOME) travel(HOME, SPAWN.x, SPAWN.y);
    Object.assign(p, {x: SPAWN.x, y: SPAWN.y, tx: SPAWN.x, ty: SPAWN.y, hp: st.maxHp, sh: st.maxSh, target: null, firing: false, extra: [], launch: null, mis: [], mleft: true, mining: null, beam: false, lastHit: -99, lastShot: -99, fight: 0});
    p.deaths++; // input.ts usa isso para soltar o botão do mouse
    persist(); // a posição salva passa a ser a da base: recarregar a página não devolve a nave ao lugar onde morreu
    enemies.forEach(calm);
    float(p, 'Nave destruída — reparada na base', '#fff', 3);
  }

  const cur = map(), cb = cur.boss; // de novo: a morte pode ter levado a nave de volta ao mapa inicial
  let alive = !!cb && enemies.some(e => e.t === cb.def);
  if (cb && !alive && now >= (bossAt[world.map] ?? 0)) { enemies.push(born(cb.def, cb.x, cb.y)); alive = true; }
  quotas(cur).forEach((want, i) => { // os comuns: cada tipo completa a cota dele, na faixa dele
    for (let have = enemies.filter(e => e.t === cur.enemies[i]).length; have < want; have++) enemies.push(spawn(i, seeded));
  });
  while (rocks.length < cur.asteroids) rocks.push(rock0(seeded));
  seeded = true;
  for (let i = parts.length; i--;) { const q = parts[i]; q.x += q.vx * dt; q.y += q.vy * dt; if ((q.t -= dt) <= 0) parts.splice(i, 1); }
  for (let i = texts.length; i--;) { texts[i].y -= 30 * dt; if ((texts[i].t -= dt) <= 0) texts.splice(i, 1); }
}
