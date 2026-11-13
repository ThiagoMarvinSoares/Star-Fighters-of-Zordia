// Simulação: as regras do jogo. Só altera o estado; não sabe nada de canvas, tela nem teclado.
import { RANGE, SHOT_SPEED, MISSILE_CD, MISSILE_SPEED, MISSILE_R, KEEP_MARGIN, CLEAR, COMBAT, PORTAL_R, MINE_RANGE, ROCK_ORE, MODS, ORES, MAPS, HOME } from './data.ts';
import type { EnemyDef, MapKey } from './data.ts';
import type { ModelKey, ModKey } from './data.ts';
import { save, persist, stats, cargoUsed, p, enemies, rocks, shots, texts, parts, events, world, map } from './state.ts';
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
  enemies.length = rocks.length = shots.length = parts.length = texts.length = 0;
  Object.assign(p, {x, y, tx: x, ty: y, target: null, mining: null, beam: false});
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

const born = (t: EnemyDef, x: number, y: number): Enemy => ({t, x, y, wx: x, wy: y, a: 0, hp: t.hp, sh: t.sh, cd: 0, lastHit: -99, hostile: false});
// Sorteia com pick() um ponto que passe em ok() e fique a pelo menos far do jogador. Em mapa pequeno pode não existir
// ponto tão longe: depois de 40 sorteios fica o candidato válido mais distante, em vez de sortear para sempre.
function place(pick: () => Point, ok: (q: Point) => boolean, far: number): Point {
  let best: Point | undefined, bd = -1;
  for (let i = 0; i < 400 && !(i >= 40 && best); i++) {
    const q = pick();
    if (!ok(q)) continue;
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
// away = reposição de um inimigo destruído: nasce longe do jogador (a população inicial ignora isso, senão o começo ficaria vazio)
function spawn(away: boolean): Enemy {
  // o: de onde se mede a força (a base ou, sem base, o ponto de chegada). Nunca em cima da base nem do jogador.
  const m = map(), o = m.base ?? m.spawn, gap = m.base ? m.base.r + 300 : 0;
  const {x, y} = place(() => ({x: rnd(0, m.w), y: rnd(0, m.h)}), q => dist(q, o) >= gap, away ? CLEAR : 600);
  // Quanto mais longe da base, mais forte: a distância escolhe um degrau da lista de inimigos e o sorteio mistura
  // com os vizinhos, puxando mais para o lado fraco. Perto da base só nascem os dois primeiros.
  const far = clamp((dist({x, y}, o) / Math.hypot(m.w, m.h) - .14) / .62, 0, 1);
  const t = m.enemies[clamp(Math.round(far * (m.enemies.length - 1) + rnd(-1.3, .5)), 0, m.enemies.length - 1)];
  return born(t, x, y);
}

// dispara o tiro i da nave src (modelo key), saindo do ponto de fixação i, depois de delay segundos
const shoot = (src: Player | Enemy, r: number, key: ModelKey, i: number, tgt: Player | Enemy, dmg: number, c: string, delay: number, mod?: ModKey, miss = false, missile = false) => {
  const a = rnd(0, 6.28), m = ('t' in tgt ? tgt.t.r : 20) * 1.5 + rnd(25, 60); // quem erra passa ao lado do alvo, fora do casco
  shots.push({src, r, hard: HARD[key][i % HARD[key].length], tgt, dmg, c, delay, mod, live: false, x: 0, y: 0, a: 0, h: 0, missile,
              off: miss ? {x: Math.cos(a) * m, y: Math.sin(a) * m} : undefined});
};

export function update(dt: number) {
  events.length = 0; // eventos valem por um quadro
  now += dt;
  const st = stats();
  if (step(p, p.tx, p.ty, st.speed * dt)) thrust(p, st.r, save.ship, st.flame); // a chama tem a cor do motor equipado
  const m = map(), base = m.base, boss = m.boss;
  p.x = clamp(p.x, 0, m.w); p.y = clamp(p.y, 0, m.h);
  // portal: encostou, mudou de mapa; o resto do quadro não vale mais (o mapa novo é povoado no próximo)
  for (const g of m.portals) if (dist(p, g) < PORTAL_R) { travel(g.to, g.tx, g.ty); return; }

  // Zona segura: dentro da base e fora de combate. Quem atirou ou levou dano há menos de COMBAT segundos continua em
  // combate mesmo dentro da base: os inimigos seguem atirando e a cura rápida não liga.
  p.fight = Math.max(0, COMBAT - (now - Math.max(p.lastHit, p.lastShot)));
  const safe = !!base && dist(p, base) < base.r && p.fight <= 0;
  // Inimigo que desiste da luta volta inteiro: sem isso dava para ferir, fugir, curar e voltar até vencer qualquer um.
  // O chefe é a exceção: a luta contra ele é feita em várias investidas, e a vida dele fica entre uma e outra.
  const calm = (e: Enemy) => { if (e.hostile) { e.hostile = false; if (!boss || e.t !== boss.def) { e.hp = e.t.hp; e.sh = e.t.sh; } } };
  if (safe) enemies.forEach(calm); // o jogador ficou a salvo: quem o perseguia desiste
  if (now - p.lastHit > 5) p.sh = Math.min(st.maxSh, p.sh + st.maxSh * .08 * dt);
  if (safe || now - p.lastHit > 10) p.hp = Math.min(st.maxHp, p.hp + st.maxHp * (safe ? .2 : .03) * dt);

  // ---------- armas do jogador ----------
  p.cd -= dt;
  // mira automática: sem alvo ao alcance, trava o inimigo mais próximo que estiver dentro do alcance
  if (p.auto && !safe && !(p.target && dist(p, p.target) <= RANGE)) {
    let best = RANGE;
    for (const e of enemies) { const d = dist(p, e); if (d <= best) { best = d; p.target = e; } }
  }
  const t = p.target;
  if (t) {
    const td = dist(p, t);
    if (td > 1500) p.target = null;
    else if (!safe && (p.firing || p.auto) && td <= RANGE && p.cd <= 0 && st.dmg) { // a salvo na base ninguém atira
      p.cd = 1; t.hostile = true; p.lastShot = now;
      // um tiro por módulo de laser, cada um saindo do seu ponto de fixação e com o dano do seu módulo
      save.mods.filter(m => MODS[m].type === 'laser').forEach((m, i, l) =>
        shoot(p, st.r, save.ship, i, t, Math.round(MODS[m].val * rnd(.85, 1.15)), '#4cf', i / l.length, m, rand() >= st.acc));
    }
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
    else if (free <= 1e-9) { p.mining = null; float(p, 'Porão cheio', '#fa4', 2); }
    else if (dist(p, rock) <= MINE_RANGE) {
      const got = Math.min(st.mine * dt, rock.left, free);
      rock.left -= got; save.cargo[rock.ore] += got; p.beam = true;
      if (rock.left <= 1e-9) { // esgotou: o asteroide se desfaz (outro nasce longe dali, mais abaixo)
        rocks.splice(rocks.indexOf(rock), 1); p.mining = null; p.beam = false;
        explode(rock, rock.r * .5); float(rock, ORES[rock.ore].name + ' esgotada', ORES[rock.ore].color, 1.5);
      }
    }
  }
  if (was && !p.beam) persist();

  // mísseis: lançados a pedido (barra de atalhos), um por módulo equipado, contra o alvo travado; erram como os lasers
  p.mcd -= dt;
  if (p.launch) {
    p.launch = false;
    const ms = save.mods.filter(m => MODS[m].type === 'missile');
    if (t && p.target === t && !safe && ms.length && p.mcd <= 0 && dist(p, t) <= RANGE) {
      p.mcd = MISSILE_CD; t.hostile = true; p.lastShot = now;
      ms.forEach((m, i) => shoot(p, st.r, save.ship, i, t, MODS[m].val, '#fa4', i * .25, m, rand() >= st.acc, true));
    }
  }

  // ---------- IA dos inimigos ----------
  for (const e of enemies) {
    const ed = dist(e, p);
    if (ed > 1400) calm(e); // perdeu o jogador de vista
    if (now - e.lastHit > 6) e.sh = Math.min(e.t.sh, e.sh + e.t.sh * .05 * dt);
    e.cd -= dt;
    if (!safe && (e.hostile || e.t.aggro && ed < Math.max(450, e.t.range ?? 0))) {
      if (ed <= 280) e.a = Math.atan2(p.y - e.y, p.x - e.x);
      else if (approach(e, p.x, p.y, e.t.speed * dt)) thrust(e, e.t.r, e.t.key, e.t.color);
      if (ed < (e.t.range ?? 500) && e.cd <= 0) {
        e.cd = 1.3;
        const n = HARD[e.t.key].length;
        for (let i = 0; i < n; i++) shoot(e, e.t.r, e.t.key, i, p, Math.round(e.t.dmg / n), e.t.color, i / n * 1.3);
      }
    } else {
      if (Math.hypot(e.wx - e.x, e.wy - e.y) < 10) { // chegou: sorteia outro ponto para vagar, fora da área da base
        const c = boss && e.t === boss.def ? boss : e; // o chefe ronda o ponto dele; os outros vagam a partir de onde estão
        do { e.wx = clamp(c.x + rnd(-400, 400), 0, m.w); e.wy = clamp(c.y + rnd(-400, 400), 0, m.h); } while (base && dist({x: e.wx, y: e.wy}, base) < keepOut() + 50);
      }
      if (approach(e, e.wx, e.wy, e.t.speed * .4 * dt)) thrust(e, e.t.r, e.t.key, e.t.color, .6); // vagando: chama menor
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
    const dx = q.tgt.x + (q.off?.x ?? 0) - q.x, dy = q.tgt.y + (q.off?.y ?? 0) - q.y, d = Math.hypot(dx, dy), m = (q.missile ? MISSILE_SPEED : SHOT_SPEED) * dt;
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
      if (boss && tg.t === boss.def) bossAt[world.map] = now + boss.respawn;
      save.credits += tg.t.reward; persist();
      float(tg, '+' + tg.t.reward + ' cr', '#fd4', 1.5);
    }
  }

  // ---------- morte do jogador ----------
  if (p.hp <= 0) {
    explode(p, st.r); shots.length = 0;
    const SPAWN = MAPS[HOME].spawn; // renasce sempre na base do mapa inicial, esteja onde estiver
    if (world.map !== HOME) travel(HOME, SPAWN.x, SPAWN.y);
    Object.assign(p, {x: SPAWN.x, y: SPAWN.y, tx: SPAWN.x, ty: SPAWN.y, hp: st.maxHp, sh: st.maxSh, target: null, firing: false, launch: false, mining: null, beam: false, lastHit: -99, lastShot: -99, fight: 0});
    p.deaths++; // input.ts usa isso para soltar o botão do mouse
    enemies.forEach(calm);
    float(p, 'Nave destruída — reparada na base', '#fff', 3);
  }

  const cur = map(), cb = cur.boss; // de novo: a morte pode ter levado a nave de volta ao mapa inicial
  let alive = !!cb && enemies.some(e => e.t === cb.def);
  if (cb && !alive && now >= (bossAt[world.map] ?? 0)) { enemies.push(born(cb.def, cb.x, cb.y)); alive = true; }
  while (enemies.length < cur.population + +alive) enemies.push(spawn(seeded)); // os comuns, fora o chefe
  while (rocks.length < cur.asteroids) rocks.push(rock0(seeded));
  seeded = true;
  for (let i = parts.length; i--;) { const q = parts[i]; q.x += q.vx * dt; q.y += q.vy * dt; if ((q.t -= dt) <= 0) parts.splice(i, 1); }
  for (let i = texts.length; i--;) { texts[i].y -= 30 * dt; if ((texts[i].t -= dt) <= 0) texts.splice(i, 1); }
}
