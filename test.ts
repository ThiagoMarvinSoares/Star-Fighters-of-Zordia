// Teste das regras do jogo, sem navegador: `npm test`. Só usa a simulação (sim.ts), nunca o desenho.
import assert from 'node:assert/strict';
import { SHIPS, MODS, ORES, ENEMIES, START, CLEAR, COMBAT, ACCURACY, MISSILE_CD, MINE_RANGE, PORTAL_R, BOSS, MAPS, HOME } from './src/game/data.ts';
import type { EnemyKey, MapDef, MapKey, ModKey, ShipKey } from './src/game/data.ts';
import { world, best, rocks, cargoUsed, cargoValue, sellOre, sellCargo, atBase, save, trim, stats, p, enemies, shots, parts, events, buyMod, sellMod, equip, unequip, buyShip, useShip } from './src/game/state.ts';
import type { Enemy } from './src/game/state.ts';
import { HARD, ENGINES, mount } from './src/game/models.ts';
import { update, hit, explode, keepOut, travel } from './src/game/sim.ts';
import { keys, seed } from './src/game/util.ts';
import * as THREE from 'three';
import { TILT, COSV, minimap, toWorld, onScreen } from './src/view/camera.ts';
import { view, mouse } from './src/game/state.ts';
import { aimCamera, shipObject, modelObject, pose, adopt, parseModel, install, hasModel } from './src/view/ships3d.ts';
import { readFileSync, readdirSync } from 'node:fs';

// Sorteios fixos: o mesmo roteiro dá sempre o mesmo resultado. Para procurar casos raros, rode com outra semente:
//   SEED=7 node test.ts
seed(+(process.env.SEED ?? 20261113));

// o mapa inicial e os números dele que os testes usam
const M = MAPS[HOME], BASE = M.base!, W = M.w, POPULATION = M.population, BOSS_AT = M.boss!, BOSS_RESPAWN = M.boss!.respawn, KEEP_OUT = BASE.r + 250;
assert.equal(keepOut(), KEEP_OUT);
const frames = (n: number) => { for (let i = 0; i < n; i++) update(.016); };
const mine = () => shots.filter(q => q.src === p);
const nearest = (key: EnemyKey) => enemies.filter(e => e.t.key === key).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
const park = (e: Enemy, d: number) => { p.x = p.tx = e.x + d; p.y = p.ty = e.y; };
// Começo de cada bloco que roda a simulação: o jogador volta a um estado conhecido (parado onde está, inteiro, sem
// alvo, armas e feixe desligados) e somem tiros, partículas e perseguições deixados pelo bloco anterior.
const reset = () => {
  Object.assign(p, {tx: p.x, ty: p.y, target: null, firing: false, auto: false, launch: false, mining: null, beam: false, cd: 0, mcd: 0, hp: stats().maxHp, sh: stats().maxSh, lastHit: -99, lastShot: -99, fight: 0});
  shots.length = 0; parts.length = 0;
  for (const e of enemies) e.hostile = false;
};

// escudo absorve primeiro
{ const e = {hp: 100, sh: 50, lastHit: 0}; assert(!hit(e, 80) && e.sh === 0 && e.hp === 70 && hit(e, 70)); }

// limites de slot por tipo e um ponto de fixação por slot de arma
assert.deepEqual(trim(['L1', 'L1', 'L1', 'L1', 'S1', 'S1', 'E1', 'A1', 'A2', 'zz', 'toString', 7], 'scout'), ['L1', 'L1', 'L1', 'S1', 'E1', 'A1']);
for (const k of keys(SHIPS) as ShipKey[]) assert.equal(HARD[k].length, SHIPS[k].slots.laser, k);

// cor da chama e da aura: a do melhor módulo do tipo; sem módulo, o azul padrão
{
  const keep = [...save.mods];
  assert.equal(stats().flame, '#66ccff');
  save.mods.push('E1'); assert.equal(stats().flame, '#f0902a');
  save.mods.push('E2'); assert.equal(stats().flame, '#35c8f5');
  assert.equal(stats().aura, '#35c8f5');
  save.mods.length = 0; save.mods.push(...keep);
}

// hangar: comprar, guardar, equipar, desequipar e vender
{
  const keep = {credits: save.credits, ship: save.ship, owned: [...save.owned], mods: [...save.mods], inv: [...save.inv]};
  Object.assign(save, {credits: 10000, ship: 'scout', owned: ['scout'], mods: ['L1', 'L1', 'L1', 'S1'], inv: ['L1']}); // armas cheias (3/3)
  // fora da zona segura nada é permitido, e nada muda
  p.x = BASE.x + BASE.r + 50; p.y = BASE.y;
  assert(!atBase() && !buyMod('E1') && !sellMod('inv', 0) && !unequip(0) && !equip(0) && !buyShip('corvette') && !useShip('scout'));
  assert.deepEqual([save.credits, save.mods.length, save.inv.length, save.ship], [10000, 4, 1, 'scout']);
  p.x = BASE.x; p.y = BASE.y; save.inv.length = 0; // na base
  let c = 10000 - MODS.E1.cost;
  assert(buyMod('E1') && save.mods.includes('E1') && save.credits === c);     // slot de motor livre: vai para a nave
  assert(buyMod('L2') && save.inv.join() === 'L2' && save.mods.length === 5); // armas cheias: vai para o inventário
  assert(!equip(0));                                                          // sem slot de arma livre
  assert(unequip(0) && save.inv.join() === 'L2,L1' && save.mods.join() === 'L1,L1,S1,E1');
  assert(equip(0) && save.mods.join() === 'L1,L1,S1,E1,L2' && save.inv.join() === 'L1');
  c += -MODS.L2.cost + MODS.L1.cost / 2;
  assert(sellMod('inv', 0) && !save.inv.length && save.credits === c);
  assert(sellMod('mods', 2) && stats().maxSh === 0 && !sellMod('inv', 5));
  save.credits = 100; assert(!buyMod('L1') && !buyShip('corvette') && save.credits === 100); // sem créditos nada muda
  // naves: comprar soma ao hangar e já passa a usar; trocar de nave manda os módulos equipados para o inventário
  const worn = [...save.mods];
  save.credits = 25000; assert(!useShip('corvette'));                                         // ainda não tem
  assert(buyShip('corvette') && save.ship === 'corvette' && save.credits === 25000 - SHIPS.corvette.cost);
  assert(save.owned.join() === 'scout,corvette' && !save.mods.length && save.inv.join() === worn.join());
  assert(!buyShip('corvette') && !buyShip('scout') && !useShip('corvette'));                 // já tem; já está em uso
  assert(equip(0) && save.mods.length === 1 && useShip('scout') && (save.ship as ShipKey) === 'scout' && !save.mods.length && save.inv.length === worn.length);
  Object.assign(save, keep);
}

// Economia: a progressão não pode travar. Um jogador que sempre caça o inimigo mais rentável que aguenta e compra a
// melhoria que mais aumenta a renda por crédito, entre as que consegue pagar em até 8 minutos, sempre tem uma dessas ao
// alcance: nunca espera mais de 8 minutos por uma compra, e a 1ª é imediata. (Ele não fica parado juntando para um item
// caro, como o Míssil Mk4, enquanto há melhoria mais barata disponível.)
{
  type Kit = { ship: ShipKey; laser: ModKey[]; shield: ModKey[]; engine: ModKey[]; aim: ModKey[]; missile: ModKey[]; mining: ModKey[] };
  const ships = keys(SHIPS), sum = (l: ModKey[]) => l.reduce((a, m) => a + MODS[m].val, 0);
  const income = (k: Kit) => { // créditos por minuto
    const dps = (sum(k.laser) + sum(k.missile) / MISSILE_CD) * Math.min(1, ACCURACY + sum(k.aim) / 100), sh = sum(k.shield), hp = SHIPS[k.ship].hp, spd = SHIPS[k.ship].speed + sum(k.engine);
    return Math.max(0, ...ENEMIES.map(e => {
      const fight = (e.hp + e.sh) / dps, taken = e.dmg / 1.3 * fight;
      if (taken > sh + .35 * hp) return 0; // não aguenta caçar esse em sequência
      return e.reward / (fight + 10 * 260 / spd + (sh ? 5 + taken / sh * 12 : 8)) * 60; // luta + viagem + regenerar o escudo
    }));
  };
  const options = (k: Kit) => { // [custo líquido, kit resultante]
    const out: [number, Kit][] = [];
    for (const m of keys(MODS)) {
      const t = MODS[m].type, cur = k[t];
      if (cur.length < SHIPS[k.ship].slots[t]) out.push([MODS[m].cost, {...k, [t]: [...cur, m]}]);
      else {
        const worst = [...cur].sort((a, b) => MODS[a].val - MODS[b].val)[0];
        if (worst && MODS[worst].val < MODS[m].val) { const l = [...cur]; l.splice(l.indexOf(worst), 1, m); out.push([MODS[m].cost - MODS[worst].cost / 2, {...k, [t]: l}]); }
      }
    }
    const next = ships[ships.indexOf(k.ship) + 1];
    if (next) out.push([SHIPS[next].cost, {...k, ship: next}]);
    return out;
  };
  const byType = (t: string) => START.mods.filter(m => MODS[m].type === t);
  let kit: Kit = {ship: START.ship, laser: byType('laser'), shield: byType('shield'), engine: byType('engine'), aim: byType('aim'), missile: byType('missile'), mining: byType('mining')}, bank: number = START.credits, worst = 0, n = 0;
  for (let opts = options(kit); opts.length; opts = options(kit), n++) {
    const inc = income(kit), ehp = (k: Kit) => SHIPS[k.ship].hp + sum(k.shield);
    const waitFor = (cost: number) => Math.max(0, cost - bank) / inc;
    opts.sort((a, b) => (income(b[1]) - inc) / b[0] - (income(a[1]) - inc) / a[0] || (ehp(b[1]) - ehp(a[1])) / b[0] - (ehp(a[1]) - ehp(kit)) / a[0] || a[0] - b[0]);
    const [cost, nextKit] = opts.find(o => waitFor(o[0]) < 8) ?? opts[0];
    const wait = waitFor(cost);
    if (n === 0) assert.equal(wait, 0, 'a primeira compra tem de caber nos créditos iniciais');
    worst = Math.max(worst, wait); bank = Math.max(0, bank - cost); kit = nextKit;
  }
  assert(n > 30 && worst < 8, `maior espera entre compras: ${worst.toFixed(1)} min em ${n} compras`);
  for (let i = 1; i < ENEMIES.length; i++) assert(ENEMIES[i].reward > ENEMIES[i - 1].reward * 1.5 && ENEMIES[i].reward < ENEMIES[i - 1].reward * 3, ENEMIES[i].name);
}

// o mundo roda sem NaN
frames(300);
assert.equal(enemies.length, POPULATION + 1); // os comuns + o chefe
assert(Number.isFinite(p.x) && Number.isFinite(p.hp));

// voar até um Drone e matar rende a recompensa dele
{
  reset();
  const c0 = save.credits, prey = nearest('drone');
  p.firing = true; p.target = prey;
  for (let i = 0; i < 20000 && save.credits === c0; i++) { p.target ??= prey; p.tx = prey.x; p.ty = prey.y; update(.016); }
  assert.equal(save.credits, c0 + prey.t.reward);
}

// uma salva = um tiro por laser, cada um de um ponto de fixação diferente, e eles acertam
{
  reset();
  const e = nearest('raider'), lasers = save.mods.filter(m => m[0] === 'L').length, hp0 = e.hp + e.sh;
  park(e, 150); p.target = e; p.firing = true;
  frames(1);
  assert.equal(mine().length, lasers);
  assert.equal(new Set(mine().map(q => q.hard)).size, lasers);
  // a simulação registra tiro e impacto como eventos (é o que o áudio toca), e eles valem por um quadro
  const seen = new Set<string>();
  for (let i = 0; i < 600 && !(seen.has('shottrue') && seen.has('hit')); i++) { p.target = e; update(.016); for (const ev of events) if (ev.kind !== 'hit' || !ev.onPlayer) seen.add(ev.kind + (ev.kind === 'shot' ? ev.mine : '')); } // várias salvas: tiros podem errar; só vale acerto no inimigo
  assert(seen.has('shottrue') && seen.has('hit'));
  frames(1); p.cd = 0; frames(1); // nova salva: o tiro registra qual laser disparou (é o que escolhe o som)
  for (let i = 0; i < 70 && !events.some(ev => ev.kind === 'shot' && ev.mine); i++) frames(1);
  assert(events.some(ev => ev.kind === 'shot' && ev.mine && ev.mod === 'L1'));
  assert(e.hp + e.sh < hp0);
}

// precisão: sem mira, cerca de 75% dos tiros acertam; com a Mira Mk3, todos. Tiro que erra não causa dano
{
  reset();
  const keep = [...save.mods], e = nearest('drone');
  const rate = () => { // fração de acertos em ~200 tiros contra um alvo que não morre
    let fired = 0, hits = 0;
    shots.length = 0; p.firing = true;
    for (let i = 0; i < 7000; i++) {
      e.hp = p.hp = 1e9; park(e, 150); p.target = e;
      update(.016);
      for (const ev of events) { if (ev.kind === 'shot' && ev.mine) fired++; if (ev.kind === 'hit' && !ev.onPlayer) hits++; }
    }
    assert(fired > 150, `só ${fired} tiros`);
    return hits / fired;
  };
  assert.equal(stats().acc, ACCURACY);
  const base = rate();
  assert(Math.abs(base - ACCURACY) < .15, `sem mira: ${base}`);
  save.mods.push('A3'); assert.equal(stats().acc, ACCURACY + MODS.A3.val / 100);
  const aimed = rate();
  assert.equal(aimed, 1, 'a Mira Mk3 acerta sempre');
  save.mods.length = 0; save.mods.push(...keep);
  e.hp = e.t.hp; p.hp = stats().maxHp; p.firing = false; p.target = null; shots.length = 0;
}

// mísseis: lançados a pedido contra o alvo travado, um por módulo; têm recarga, causam o dano cheio quando acertam e
// erram com a mesma chance dos lasers (aqui a Mira Mk3 garante o acerto; sem mira, parte deles erra)
{
  reset();
  const keep = [...save.mods], e = nearest('raider'), flying = () => shots.filter(q => q.missile).length;
  shots.length = 0; park(e, 300); p.target = e; p.firing = false; p.auto = false; p.mcd = 0; e.hp = e.t.hp; e.sh = e.t.sh; p.hp = 1e9;
  p.launch = true; frames(1);
  assert(!flying() && !p.launch, 'sem míssil equipado não lança');
  save.mods.push('M1', 'A3'); assert.equal(best('missile'), 'M1'); assert.equal(best('laser'), 'L1');
  p.launch = true; frames(1);
  assert.equal(flying(), 1);
  p.launch = true; frames(1);
  assert.equal(flying(), 1, 'recarga: não lança de novo em seguida');
  for (let i = 0; i < 200 && flying(); i++) { park(e, 300); update(.016); }
  assert.equal(e.hp + e.sh, e.t.hp + e.t.sh - MODS.M1.val);
  save.mods.pop(); // sem a mira: em 40 lançamentos, alguns erram e alguns acertam
  let hits = 0;
  for (let n = 0; n < 40; n++) {
    e.hp = 1e9; const before = e.hp + e.sh; p.mcd = 0; p.launch = true; // vida + escudo: o acerto pode parar no escudo
    for (let i = 0; i < 200 && (i < 2 || flying()); i++) { park(e, 300); p.target = e; update(.016); }
    if (e.hp + e.sh < before) hits++;
  }
  assert(hits > 18 && hits < 40, `acertos sem mira: ${hits}/40`);
  e.hp = e.t.hp;
  save.mods.length = 0; save.mods.push(...keep);
  p.hp = stats().maxHp; p.target = null; shots.length = 0;
}

// mineração: asteroides no mapa, fora da base; o feixe só liga com minerador, ao alcance e com espaço no porão;
// extrai no ritmo do módulo, esgota o asteroide (outro nasce longe) e a carga é vendida pelo preço de cada minério
{
  reset();
  const keep = {mods: [...save.mods], credits: save.credits, cargo: {...save.cargo}};
  assert.equal(rocks.length, M.asteroids);
  for (const k of rocks) assert(Math.hypot(k.x - BASE.x, k.y - BASE.y) >= BASE.r + 150 && k.left > 0 && Object.hasOwn(ORES, k.ore), 'asteroide mal colocado');
  for (const k of keys(ORES)) save.cargo[k] = 0;
  const k = rocks[0]; k.left = 10; p.target = null; p.firing = false;
  const near = (o = k) => { p.x = p.tx = o.x + 100; p.y = p.ty = o.y; p.hp = 1e9; }; // ao lado do asteroide, e sem morrer para quem passar atirando
  near(); p.mining = k; frames(1);
  assert(!p.mining && !p.beam && k.left === 10, 'sem minerador não minera');
  save.mods.push('D2'); assert.equal(stats().mine, MODS.D2.val);
  p.x = p.tx = k.x + (k.x > W / 2 ? -1 : 1) * (MINE_RANGE + 200); p.hp = 1e9; p.mining = k; frames(10); // para o lado de dentro do mapa
  assert(p.mining === k && !p.beam && k.left === 10, 'longe demais: escolhido, mas o feixe não liga');
  for (let i = 0; i < 100; i++) { near(); update(.01); } // 1 segundo ao alcance
  assert(p.beam && Math.abs(save.cargo[k.ore] - MODS.D2.val) < 1e-6 && Math.abs(k.left - (10 - MODS.D2.val)) < 1e-6, `1 s de feixe: ${save.cargo[k.ore]}`);
  for (let i = 0; i < 1000 && rocks.includes(k); i++) { near(); update(.01); } // até esgotar
  assert(!rocks.includes(k) && !p.mining && !p.beam && Math.abs(save.cargo[k.ore] - 10) < 1e-6);
  frames(1);
  assert.equal(rocks.length, M.asteroids);
  assert(Math.hypot(rocks.at(-1)!.x - p.x, rocks.at(-1)!.y - p.y) >= CLEAR - 5, 'o asteroide de reposição nasce longe do jogador');
  // porão cheio: o feixe desliga e a carga não passa do limite da nave
  const k2 = rocks[0]; k2.left = 50; save.cargo[k2.ore] += stats().cargo - cargoUsed() - 1;
  p.mining = k2; for (let i = 0; i < 300; i++) { near(k2); update(.01); }
  assert(Math.abs(cargoUsed() - stats().cargo) < 1e-6 && !p.mining && !p.beam && Math.abs(k2.left - 49) < 1e-6, `porão: ${cargoUsed()}`);
  // venda: só unidades inteiras, pelo preço de cada minério
  for (const o of keys(ORES)) save.cargo[o] = 0;
  save.cargo.purple = 10.5; save.cargo.blue = 3; save.credits = 100;
  assert(!atBase() && sellOre('purple', 4) === 0 && sellCargo() === 0 && save.credits === 100, 'fora da base não vende');
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; assert(atBase());
  const worth = 10 * ORES.purple.price + 3 * ORES.blue.price;
  assert.equal(cargoValue(), worth);
  assert(sellOre('purple', 4) === 4 * ORES.purple.price && save.cargo.purple === 6.5 && save.credits === 100 + 4 * ORES.purple.price, 'vende um pack');
  assert(sellOre('blue', 99) === 3 * ORES.blue.price && save.cargo.blue === 0 && sellOre('blue', 5) === 0, 'não vende mais do que há');
  assert.equal(sellCargo(), 6 * ORES.purple.price);
  assert.deepEqual([save.credits, save.cargo.purple, sellCargo()], [100 + worth, .5, 0]);
  save.mods.length = 0; save.mods.push(...keep.mods); save.credits = keep.credits; Object.assign(save.cargo, keep.cargo);
  p.mining = null; parts.length = 0; p.hp = stats().maxHp;
}

// chama dos motores: toda nave com motor tem bocais definidos, na metade de trás do modelo, e ao se mover solta uma
// partícula por bocal, saindo exatamente de lá; alienígena orgânico não tem bocal nem chama
{
  reset();
  for (const k of keys(SHIPS)) assert(ENGINES[k].length && ENGINES[k].every(e => e[0] < -.5), `${k}: bocais na traseira`);
  for (const e of ENEMIES) assert.equal(!ENGINES[e.key].length, !!e.organic, e.name);
  assert(BOSS.organic && !ENGINES.boss.length);
  parts.length = 0; shots.length = 0; p.target = null; p.firing = false;
  p.x = p.tx = 3000; p.y = p.ty = 2000; p.tx = 3500; update(.016);
  const mineFlames = parts.filter(q => q.c === stats().flame && q.life === .3), r = stats().r;
  assert.equal(mineFlames.length, ENGINES[save.ship].length);
  for (const e of ENGINES[save.ship]) { const at = mount(p, r, e); assert(mineFlames.some(q => Math.hypot(q.x - at.x, q.y - at.y) < r * .35), 'chama fora do bocal'); }
  p.tx = p.x; p.ty = p.y;
}

// mira automática: sem alvo e com lasers desligados, só atira depois de ligada
{
  reset();
  const e = nearest('drone');
  shots.length = 0; park(e, 200); p.target = null; p.firing = false; p.cd = 0;
  frames(1);
  assert(!p.target && !mine().length);
  p.auto = true; frames(1);
  assert(p.target && mine().length);
  p.auto = false;
}

// zona segura vale para os dois lados: da base o jogador não atira nem trava alvo sozinho
{
  reset();
  const e = nearest('drone');
  shots.length = 0; p.x = p.tx = BASE.x + 400; p.y = p.ty = BASE.y; p.target = null; p.cd = 0; p.auto = true;
  e.x = e.wx = p.x + 200; e.y = e.wy = p.y; e.hostile = false; // pode ter ficado hostil no teste anterior
  frames(5);
  assert(!p.target && !mine().length && !e.hostile);
  p.target = e; p.firing = true; frames(5);
  assert(!mine().length);
  p.auto = p.firing = false;
}

// combate: quem atirou não fica a salvo ao entrar na base. Enquanto dura o combate os inimigos seguem atirando e a cura
// rápida não liga; passado o tempo sem atirar nem apanhar, a zona protege de novo e o inimigo que desistiu volta inteiro
{
  reset();
  const e = nearest('raider');
  e.x = e.wx = BASE.x + BASE.r + 260; e.y = e.wy = BASE.y; e.hp = e.t.hp; e.sh = e.t.sh; e.cd = 0; // logo além da faixa onde inimigo não entra
  p.x = p.tx = BASE.x + BASE.r + 20; p.y = p.ty = BASE.y; p.target = e; p.firing = true; // um passo fora da base
  for (let i = 0; i < 80 && e.hp + e.sh >= e.t.hp + e.t.sh; i++) frames(1); // atira até ferir o inimigo
  assert(e.hp + e.sh < e.t.hp + e.t.sh && e.hostile && p.fight > COMBAT - 2, 'o combate começa ao atirar');
  p.firing = false; p.target = null; p.x = p.tx = BASE.x + BASE.r - 30; shots.length = 0; e.cd = 0; // volta para dentro da base
  const hp0 = p.hp + p.sh;
  for (let i = 0; i < 200; i++) { p.hp = Math.max(p.hp, 500); frames(1); } // ~3 s dentro da base, sem morrer
  assert(atBase() && p.fight > 0 && e.hostile, 'dentro da base, ainda em combate');
  assert(p.hp + p.sh < hp0, 'o inimigo continua acertando quem entrou na base em combate');
  assert(e.hp + e.sh < e.t.hp + e.t.sh, 'e não se recupera enquanto a luta dura');
  // fora do alcance dele (fundo da base), sem atirar: o combate acaba, a zona volta a proteger e o inimigo se recupera
  p.x = p.tx = BASE.x; shots.length = 0;
  for (let i = 0; i < (COMBAT + 1) / .05 && p.fight > 0; i++) update(.05);
  frames(1);
  assert(p.fight === 0 && !e.hostile && e.hp === e.t.hp && e.sh === e.t.sh, 'fim do combate: inimigo inteiro de novo');
  const hurt = p.hp = stats().maxHp / 2; frames(30);
  assert(p.hp > hurt * 1.15, 'a salvo, a cura rápida liga');
  // o chefe não se recupera ao desistir: a luta contra ele é em várias investidas
  const b = enemies.find(o => o.t === BOSS)!; b.hp = 1000; b.hostile = true; frames(1);
  assert(!b.hostile && b.hp === 1000);
  b.hp = BOSS.hp;
}

// inimigos não chegam perto da base: nem perseguindo o jogador que está logo fora da zona segura, nem vagando
{
  reset();
  const e = nearest('raider');
  p.x = p.tx = BASE.x + BASE.r + 30; p.y = p.ty = BASE.y; p.target = null; p.hp = 1e9; // jogador como isca, sem morrer
  e.x = e.wx = BASE.x - 800; e.y = e.wy = BASE.y + 60; e.hostile = true; // do outro lado: o caminho reto passa por cima da base
  for (let i = 0; i < 1000; i++) { update(.016); for (const o of enemies) assert(Math.hypot(o.x - BASE.x, o.y - BASE.y) >= KEEP_OUT - 1e-6); }
  assert(Math.hypot(e.x - p.x, e.y - p.y) < 300); // contornou a base pela borda e chegou ao jogador
  p.hp = stats().maxHp; shots.length = 0;
}

// chefe: um só, rondando o ponto dele; destruído, paga a recompensa e só volta depois de BOSS_RESPAWN segundos
{
  reset();
  const bosses = () => enemies.filter(e => e.t === BOSS), b = bosses()[0], c0 = save.credits;
  assert.equal(bosses().length, 1);
  assert(Math.hypot(b.x - BOSS_AT.x, b.y - BOSS_AT.y) < 600, 'o chefe se afastou do ponto dele');
  b.hp = 1; b.sh = 0; b.lastHit = Infinity; // sem regenerar o escudo enquanto os tiros não chegam
  for (let i = 0; i < 3000 && bosses().length; i++) { park(b, 150); p.target = b; p.firing = true; p.hp = 1e9; update(.016); } // vida reposta a cada quadro: o chefe não pode matar o jogador antes
  assert(!bosses().length && save.credits === c0 + BOSS.reward);
  p.firing = false; p.target = null; p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; // espera na base, a salvo
  const wait = BOSS_RESPAWN / .05;
  for (let i = 0; i < wait - 20; i++) update(.05);
  assert.equal(bosses().length, 0);
  for (let i = 0; i < 40; i++) update(.05);
  assert.equal(bosses().length, 1);
  p.hp = stats().maxHp; shots.length = 0;
}

// reposição: quem substitui os inimigos destruídos nasce longe do jogador, nunca na área que ele está limpando
{
  reset();
  p.x = p.tx = 3000; p.y = p.ty = 2000; p.target = null; shots.length = 0;
  const old = new Set(enemies.filter(e => e.t !== BOSS).slice(15));
  for (let i = enemies.length; i--;) if (enemies[i].t !== BOSS && !old.has(enemies[i])) enemies.splice(i, 1); // 15 destruídos de uma vez
  frames(1);
  const fresh = enemies.filter(e => e.t !== BOSS && !old.has(e));
  assert.equal(fresh.length, 15);
  for (const e of fresh) assert(Math.hypot(e.x - p.x, e.y - p.y) >= CLEAR - 5, 'inimigo renasceu perto do jogador');
}

// dados dos mapas: o inicial tem base, e todo portal leva a um ponto dentro do mapa de destino, longe dos portais de lá
assert(M.base, 'o mapa inicial precisa de base');
for (const k of keys(MAPS)) for (const g of MAPS[k].portals) {
  const to = MAPS[g.to];
  assert(to && g.tx >= 0 && g.tx <= to.w && g.ty >= 0 && g.ty <= to.h, `${k}: portal leva para fora de ${g.to}`);
  for (const o of to.portals) assert(Math.hypot(o.x - g.tx, o.y - g.ty) > PORTAL_R * 2, `${k}: quem chega em ${g.to} cai em cima de um portal`);
}
// troca de mapa (com um mapa de teste, sem base nem chefe, ligado ao inicial por um portal de cada lado)
{
  reset();
  const all = MAPS as Record<string, MapDef>, T = 'teste' as MapKey;
  all.teste = {name: 'Teste', w: 2000, h: 1500, bg: 'mapa-1.png', spawn: {x: 1000, y: 750}, population: 5, enemies: [ENEMIES[0]], asteroids: 3, ores: ['blue'],
               portals: [{x: 300, y: 300, to: HOME, tx: 3000, ty: 2300}]};
  M.portals.push({x: 3000, y: 2000, to: T, tx: 1000, ty: 750});
  p.x = p.tx = 3000 - PORTAL_R - 40; p.y = p.ty = 2000; p.target = null; p.hp = stats().maxHp;
  frames(1); assert.equal(world.map, HOME, 'ainda fora do portal');
  p.tx = 3000; for (let i = 0; i < 200 && world.map === HOME; i++) frames(1); // voa até o portal
  assert.equal(world.map, T);
  assert.deepEqual([p.x, p.y, p.tx, enemies.length, shots.length], [1000, 750, 1000, 0, 0]);
  frames(1);
  assert.equal(enemies.length, 5); // povoado com os inimigos do mapa novo, sem chefe
  assert(rocks.length === 3 && rocks.every(k => k.ore === 'blue' && k.x <= 2000 && k.y <= 1500), 'asteroides do mapa novo');
  assert(enemies.every(e => e.t === ENEMIES[0] && e.x <= 2000 && e.y <= 1500 && Math.hypot(e.x - p.x, e.y - p.y) >= 600));
  // mapa menor que CLEAR: não existe ponto "longe o bastante" do jogador; a reposição fica com o mais longe que achar, sem travar
  enemies.pop(); rocks.pop(); frames(1);
  assert.deepEqual([enemies.length, rocks.length], [5, 3]);
  p.tx = 5000; frames(600); assert.equal(p.x, 2000, 'a nave não sai do mapa menor'); // limites do mapa atual
  // sem base não há zona segura: dá para atirar em qualquer lugar; e quem morre volta para a base do mapa inicial
  const e = enemies.find(o => Math.hypot(o.x + 150 - 300, o.y - 300) > PORTAL_R + 100)!; // longe do portal, para estacionar ao lado sem cair nele
  park(e, 150); p.target = e; p.firing = true; p.cd = 0; frames(1);
  assert(mine().length, 'atira em mapa sem base');
  p.firing = false; p.hp = -1e6; frames(1);
  assert.equal(world.map, HOME); assert.deepEqual([p.x, p.y, p.hp], [M.spawn.x, M.spawn.y, stats().maxHp]);
  frames(1); assert.equal(enemies.filter(o => o.t !== BOSS).length, POPULATION);
  // o portal de volta, e a limpeza
  travel(T, 300 + PORTAL_R + 30, 300); p.tx = 300; for (let i = 0; i < 200 && world.map === T; i++) frames(1);
  assert.equal(world.map, HOME); assert.deepEqual([p.x, p.y], [3000, 2300]);
  M.portals.length = 0; delete all.teste;
  frames(1);
}

// partículas nascem e somem
{
  reset();
  const n = parts.length; explode({x: 0, y: 0}, 20);
  assert(parts.length > n && events.some(ev => ev.kind === 'boom'));
  frames(1); assert(!events.some(ev => ev.kind === 'boom'));
  p.target = null; frames(200);
  assert(parts.every(q => Number.isFinite(q.x)));
}

// zoom da câmera: o ponto do mundo sob o mouse e o que conta como "na tela" acompanham o zoom
{
  p.x = 3000; p.y = 2000; mouse.x = view.w / 2 + 200; mouse.y = view.h / 2 + 110;
  assert.deepEqual(toWorld(), {x: 3200, y: 2000 + 110 / TILT});
  view.zoom = 2;
  assert.deepEqual(toWorld(), {x: 3100, y: 2000 + 55 / TILT});
  assert(!onScreen({x: 3000 + view.w / 2, y: 2000}, 0) && onScreen({x: 3000 + view.w / 4 - 1, y: 2000}, 0), 'de perto, cabe metade do mundo na tela');
  view.zoom = 1; assert(onScreen({x: 3000 + view.w / 2 - 1, y: 2000}, 0));
}

// minimapa: cabe o mapa inteiro, na mesma proporção, encostado no canto inferior direito da tela (1280x720 no teste)
{ const m = minimap(); assert.deepEqual([m.w, m.h, m.x, m.y], [180, 120, 1088, 588]); assert.equal(m.k * W, 180); }

// 3D: a câmera do three.js projeta igual à conta 2D do jogo (senão naves e anéis/barras desalinham)
{
  const cam = new THREE.OrthographicCamera(), w = 800, h = 600, c = {x: 500, y: 300};
  aimCamera(cam, c, w, h); cam.updateMatrixWorld();
  for (const [x, alt, y] of [[620, 40, 250], [130, 0, 590], [500, 12, 300]]) {
    const v = new THREE.Vector3(x, alt, y).project(cam);
    assert(Math.abs((v.x + 1) / 2 * w - (w / 2 + x - c.x)) < 1e-6);
    assert(Math.abs((1 - v.y) / 2 * h - (h / 2 + (y - c.y) * TILT - alt * COSV)) < 1e-6);
  }
}
// 3D: a frente do modelo segue o ângulo da nave, e o ponto de onde o tiro sai (mount) acompanha o casco desenhado
{
  const o = {x: 100, y: 100, a: 1}, r = 20, g = shipObject('corvette');
  pose(g, {id: g, o, r, key: 'corvette'}); g.updateMatrixWorld(true);
  const a = g.getWorldPosition(new THREE.Vector3()), b = g.localToWorld(new THREE.Vector3(1, 0, 0));
  assert(Math.abs(Math.atan2(b.z - a.z, b.x - a.x) - o.a) < 1e-9);
  for (const h of HARD.corvette) { const w = g.localToWorld(new THREE.Vector3(...h)), m = mount(o, r, h); assert(Math.abs(w.x - m.x) < 1e-9 && Math.abs(w.z - m.y) < 1e-9); }
}
// míssil em voo: item da biblioteca ampliado 10x (de .2 para 2 de comprimento), na altura pedida; sem o .glb, vem vazio
{
  assert(!hasModel('missiles/teste') && !modelObject('missiles/teste').children.length);
  install('missiles/teste', new THREE.Mesh(new THREE.BoxGeometry(.2, .02, .02)));
  const g = modelObject('missiles/teste');
  pose(g, {id: g, o: {x: 5, y: 7, a: 0}, r: 1, model: 'missiles/teste', h: 30}); g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  assert(hasModel('missiles/teste') && Math.abs(b.max.x - b.min.x - 2 * 1.5) < 1e-6 && g.position.y === 30 && g.position.x === 5 && g.position.z === 7);
}
// biblioteca de modelos: um .glb no padrão glTF (frente em +Z, qualquer tamanho, fora do centro) é encaixado
// nas convenções do jogo (frente em +X, medindo 2, centrado) e os vazios gun_N viram pontos de fixação
{
  const scene = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 8)), nose = new THREE.Object3D();
  hull.position.set(5, 2, 10); nose.name = 'gun_1'; nose.position.set(6, 2.5, 14); // ponta da frente, à direita de quem pilota
  scene.add(hull, nose);
  const {object, guns} = adopt(scene, 'ship'), box = new THREE.Box3().setFromObject(object);
  const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  near(box.min.x, -1); near(box.max.x, 1); near(box.min.z, -.375); near(box.max.z, .375); near(box.getCenter(new THREE.Vector3()).y, 0);
  near(guns[0][0], 1); near(guns[0][1], .125); near(guns[0][2], -.25);
  // arma no padrão (+Y para cima) com o cano em -Z e a peça "mount" fora da origem: o encaixe vai para a origem,
  // a base para y = 0, o cano para +X e o comprimento para GUN_LEN (.46)
  const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.name = name; m.position.set(x, y, z); return m; };
  const gun = new THREE.Group().add(part('barrel', 1, 1, 4, 3, 0, -1.5), part('mount_foot', 1, .2, 1, 3, -.6, 0));
  const gb = new THREE.Box3().setFromObject(adopt(gun, 'weapon').object), k = .46 / 4;
  near(gb.min.y, 0); near(gb.min.x, -.5 * k); near(gb.max.x, 3.5 * k); near(gb.max.z, .5 * k);
  // arma "deitada" (+Z para cima, como o mk3): cano em +X, encaixe embaixo em -Z, uma aleta de lado em +Y
  const lying = new THREE.Group().add(part('barrel', 4, 1, 1, 1.5, 0, 0), part('ship mount', 1, 1, .2, 0, 0, -.6), part('fin', 1, .2, 1, 0, .6, 0));
  const lb = new THREE.Box3().setFromObject(adopt(lying, 'weapon').object);
  near(lb.min.y, 0); near(lb.max.y, 1.2 * k); near(lb.min.x, -.5 * k); near(lb.max.x, 3.5 * k); // em pé, cano para a frente
  near(lb.min.z, -.7 * k); near(lb.max.z, .5 * k);                                              // a aleta fica de lado (só de um), não em cima
}
// módulo (gerador de escudo) deitado: caixa com o trilho "mount" embaixo em -Z -> em pé, apoiado em y = 0, medindo .2
{
  const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.name = name; m.position.set(x, y, z); return m; };
  const box3 = new THREE.Group().add(part('chassis', 1, .8, 1.2, 0, 0, 0), part('mounting rail', .8, .6, .2, 0, 0, -.7));
  const mb = new THREE.Box3().setFromObject(adopt(box3, 'module').object), ms = mb.getSize(new THREE.Vector3());
  near(mb.min.y, 0); near(ms.y, 1.4 * .2); near(ms.x, .2); near(ms.z, .8 * .2); near(mb.min.x, -.1);
}
// todo .glb da biblioteca abre e encaixa: naves medindo 2; armas com .46 de cano, para a frente e em pé;
// escudos e motores (só ícones) com .2 de lado e em pé
const FOLDERS = {ships: 'ship', weapons: 'weapon', shields: 'module', engines: 'module', aim: 'module', missiles: 'module', asteroids: 'rock', bases: 'base'} as const;
// fora do navegador não há como decodificar imagens: um substituto basta para os modelos com textura abrirem
Object.assign(globalThis, {self: globalThis, createImageBitmap: async () => ({width: 1, height: 1, close() {}})});
for (const dir of keys(FOLDERS)) for (const f of readdirSync(`public/models/${dir}`).filter(f => f.endsWith('.glb'))) {
  const buf = readFileSync(`public/models/${dir}/${f}`);
  const {object} = await parseModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, FOLDERS[dir]);
  const b = new THREE.Box3().setFromObject(object), s = b.getSize(new THREE.Vector3());
  assert(Number.isFinite(s.x) && s.x > 0, f);
  // mísseis têm dezenas de materiais, mas só viram ícone (uma foto), então o limite de malhas não vale para eles
  assert((dir === 'missiles' || object.children.length <= 12) && object.children.every(n => n instanceof THREE.Mesh), `${f}: peças não foram juntadas (uma malha por material)`);
  // acabamento: as naves do jogador vêm com o material completo (relevo/metal); todo o resto é fosco, mais leve
  const rich = object.children.some(n => ((n as THREE.Mesh).material as THREE.Material).type === 'MeshStandardMaterial');
  assert.equal(rich, dir === 'ships' && Object.hasOwn(SHIPS, f.replace('.glb', '')), `${f}: material ${rich ? 'completo' : 'fosco'} no lugar errado`);
  if (dir === 'ships' || dir === 'bases') assert(Math.abs(Math.max(s.x, s.z) - 2) < 1e-6 && s.y < 2, f);
  else if (dir === 'asteroids') assert(Math.abs(Math.max(s.x, s.y, s.z) - 2) < 1e-6, f);
  else if (dir === 'weapons') assert(Math.abs(s.x - .46) < 1e-6 && b.max.x > -b.min.x && b.max.y > -b.min.y && s.y < s.x, f);
  else assert(Math.abs(Math.max(s.x, s.z) - .2) < 1e-6 && b.max.y > -b.min.y, f);
}

console.log('ok');
