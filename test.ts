// Teste das regras do jogo, sem navegador: `npm test`. Só usa a simulação (sim.ts), nunca o desenho.
import assert from 'node:assert/strict';
import { ENEMY_MISSILE, BOSS_DROP, PICKUP_R, SHIPS, MODS, ORES, ENEMIES, START, CLEAR, LEASH, COMBAT, ACCURACY, MISSILE_CD, MISSILE_CHARGES, MINE_RANGE, PORTAL_R, BOSS, MAPS, HOME } from './src/game/data.ts';
import type { EnemyKey, MapDef, MapKey, ModKey, ShipKey } from './src/game/data.ts';
import { parseSave, persist, world, best, drops, strikes, rocks, cargoUsed, cargoValue, sellOre, sellCargo, atBase, save, trim, stats, p, enemies, shots, parts, events, buyMod, sellMod, equip, unequip, buyShip, useShip } from './src/game/state.ts';
import type { Enemy } from './src/game/state.ts';
import { HARD, ENGINES, mount } from './src/game/models.ts';
import { update, hit, explode, keepOut, travel, resume } from './src/game/sim.ts';
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
/** muda um inimigo de lugar, com casa e tudo (senão ele se acharia longe de casa e voltaria) */
const put = (e: Enemy, x: number, y: number) => { e.x = e.wx = e.hx = x; e.y = e.wy = e.hy = y; e.back = false; };
// Começo de cada bloco que roda a simulação: o jogador volta a um estado conhecido (parado onde está, inteiro, sem
// alvo, armas e feixe desligados) e somem tiros, partículas e perseguições deixados pelo bloco anterior.
const reset = () => {
  Object.assign(p, {tx: p.x, ty: p.y, target: null, firing: false, auto: false, launch: null, multi: false, extra: [], mining: null, beam: false, cd: 0, mis: [], mleft: true, hp: stats().maxHp, sh: stats().maxSh, lastHit: -99, lastShot: -99, fight: 0});
  shots.length = 0; parts.length = 0; strikes.length = 0;
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
  type Kit = { ship: ShipKey; laser: ModKey[]; shield: ModKey[]; engine: ModKey[]; aim: ModKey[]; missile: ModKey[]; mining: ModKey[]; chip: ModKey[] };
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
    for (const m of keys(MODS).filter(k => !MODS[k].drop)) { // itens de espólio não se compram
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
  let kit: Kit = {ship: START.ship, laser: byType('laser'), shield: byType('shield'), engine: byType('engine'), aim: byType('aim'), missile: byType('missile'), mining: byType('mining'), chip: byType('chip')}, bank: number = START.credits, worst = 0, n = 0;
  for (let opts = options(kit); opts.length; opts = options(kit), n++) {
    const inc = income(kit), ehp = (k: Kit) => SHIPS[k.ship].hp + sum(k.shield);
    const waitFor = (cost: number) => Math.max(0, cost - bank) / inc;
    opts.sort((a, b) => (income(b[1]) - inc) / b[0] - (income(a[1]) - inc) / a[0] || (ehp(b[1]) - ehp(a[1])) / b[0] - (ehp(a[1]) - ehp(kit)) / a[0] || a[0] - b[0]);
    // a 1ª compra é a melhor entre as que os créditos iniciais já pagam (ninguém começa o jogo esperando)
    const [cost, nextKit] = (n === 0 ? opts.find(o => waitFor(o[0]) === 0) : undefined) ?? opts.find(o => waitFor(o[0]) < 8) ?? opts[0];
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

// mísseis: cada módulo equipado é uma casa com 2 cargas só dele; um aperto lança uma, contra o alvo travado, alternando
// esquerda e direita; a recarga devolve uma carga por vez; causam o dano cheio quando acertam e erram como os lasers
{
  reset();
  const keep = [...save.mods], e = nearest('raider'), flying = () => shots.filter(q => q.missile);
  const wait = (n: number) => { for (let i = 0; i < n; i++) { park(e, 560); p.target = e; p.hp = 1e9; update(.016); } }; // de longe: os mísseis ficam mais de 1 s no ar
  const press = (slot = 0) => { p.launch = slot; wait(1); }; // slot = qual dos mísseis equipados
  e.hp = 1e9; e.sh = e.t.sh; p.target = e;
  press();
  assert(!flying().length && p.launch === null && !p.mis.length, 'sem míssil equipado não lança');
  save.mods.push('M1', 'A3'); assert.equal(best('missile'), 'M1'); assert.equal(best('laser'), 'L1'); // a Mira Mk3 garante o acerto
  const tot0 = e.hp + e.sh;
  press();
  assert.deepEqual([flying().length, p.mis[0].n], [1, 1], 'um aperto, uma carga');
  press();
  assert.deepEqual([flying().length, p.mis[0].n], [2, 0], 'segunda carga');
  assert(Math.abs(p.mis[0].t - MISSILE_CD) < .05, 'usada a última carga, a espera é a recarga inteira, não o que sobrava da primeira');
  { const [a, b] = flying(); assert(a.hard[2] < 0 && b.hard[2] > 0 && a.lane! < 0 && b.lane! > 0, 'o primeiro sai da esquerda, o segundo da direita'); }
  press();
  assert.equal(flying().length, 2, 'sem carga pronta não lança');
  for (let i = 0; i < 200 && flying().length; i++) wait(1);
  assert.equal(e.hp + e.sh, tot0 - 2 * MODS.M1.val, 'os dois acertam com o dano cheio');
  // recarga: uma carga por vez, MISSILE_CD segundos cada, contados do último lançamento
  for (let i = 0; i < (MISSILE_CD - 3) / .05; i++) { park(e, 560); update(.05); }
  assert.equal(p.mis[0].n, 0, 'ainda recarregando');
  for (let i = 0; i < 3.2 / .05; i++) { park(e, 560); update(.05); }
  assert.equal(p.mis[0].n, 1, 'voltou a primeira carga');
  for (let i = 0; i < (MISSILE_CD + .5) / .05; i++) { park(e, 560); update(.05); }
  assert.deepEqual([p.mis[0].n, p.mis[0].t], [2, 0], 'e depois a segunda');
  // dois módulos: cada um é uma casa, com as cargas e a recarga dele; usar um não gasta o outro
  { const ship0 = save.ship; save.ship = 'cruiser'; save.mods.push('M2'); press(1);
    assert.equal(p.mis.length, 2); assert.equal(flying()[0].mod, 'M2');
    assert.deepEqual(p.mis.map(c => c.n), [2, 1], 'só o segundo míssil gastou uma carga');
    press(1); press(1); press(0);
    assert.deepEqual(flying().map(q => q.mod), ['M2', 'M2', 'M1'], 'o segundo esgota sozinho; o primeiro segue pronto');
    press(5); assert.equal(flying().length, 3, 'casa sem míssil não lança');
    save.mods.splice(save.mods.indexOf('M2'), 1); save.ship = ship0; shots.length = 0; wait(1); }
  save.mods.pop(); // sem a mira: em 40 lançamentos, alguns erram e alguns acertam
  let hits = 0;
  for (let n = 0; n < 40; n++) {
    e.hp = 1e9; const before = e.hp + e.sh; for (const c of p.mis) { c.n = MISSILE_CHARGES; c.t = 0; } p.launch = 0; // vida + escudo: o acerto pode parar no escudo
    for (let i = 0; i < 200 && (i < 2 || flying().length); i++) { park(e, 300); p.target = e; update(.016); }
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
  const k = rocks[0]; k.left = 10; k.ore = 'purple'; p.target = null; p.firing = false; // Ametista: qualquer minerador, dureza 1
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
  // minério valioso é mais difícil: a Safira só sai com o Mk3, e mais devagar (dureza 3)
  const kb = rocks[0]; kb.ore = 'blue'; kb.left = 30; near(kb); p.mining = kb; frames(2);
  assert(!p.mining && !p.beam && kb.left === 30 && stats().mineLevel === 2, 'o Mk2 não extrai Safira');
  save.mods[save.mods.indexOf('D2')] = 'D3'; assert.equal(stats().mineLevel, 3);
  const blue0 = save.cargo.blue; p.mining = kb; for (let i = 0; i < 100; i++) { near(kb); update(.01); }
  assert(p.beam && Math.abs(save.cargo.blue - blue0 - MODS.D3.val / ORES.blue.hard) < 1e-6, `1 s de Mk3 em Safira: ${save.cargo.blue - blue0}`);
  for (const o of keys(ORES)) save.cargo[o] = 0;
  p.mining = null; kb.ore = 'purple'; save.mods[save.mods.indexOf('D3')] = 'D2';
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

// múltiplos alvos: com o chip equipado e ligado, os lasers se dividem entre o alvo travado e até 2 inimigos ao alcance;
// desligado ou sem chip, todos os tiros vão no alvo travado
{
  reset();
  const keep = [...save.mods], all = [...enemies], [a, b, c, d] = enemies.filter(e => e.t === ENEMIES[0]);
  enemies.length = 0; enemies.push(a, b, c, d); // só estes quatro no mapa durante o bloco (os de reposição nascem longe)
  save.mods.length = 0; save.mods.push('L1', 'L1', 'L1', 'A3');
  const volley = () => { shots.length = 0; p.cd = 0; p.x = p.tx = a.x + 150; p.y = p.ty = a.y; p.target = a; p.firing = true; p.hp = 1e9; update(.016); return mine().map(q => q.tgt); };
  put(b, a.x + 300, a.y + 100); put(c, a.x + 300, a.y - 100); put(d, a.x + 150, a.y + 400); // b e c mais perto do jogador que d
  for (const e of [a, b, c, d]) { e.hp = 1e9; e.hostile = false; }
  p.multi = true;
  assert.deepEqual(volley(), [a, a, a], 'sem o chip, ligar não muda nada');
  save.mods.push('C1'); assert.equal(stats().multi, 2);
  p.multi = false;
  assert.deepEqual(volley(), [a, a, a], 'chip equipado mas desligado: foco no alvo travado');
  p.multi = true;
  const got = volley();
  assert(got[0] === a && new Set(got).size === 3 && got.includes(b) && got.includes(c) && !got.includes(d), 'ligado: principal mais os dois mais próximos');
  assert(b.hostile && c.hostile && p.extra.length === 2, 'os alvos extras passam a reagir');
  put(c, a.x + 5000, a.y); put(d, a.x + 5000, a.y + 300); b.hostile = false;
  assert.deepEqual(volley(), [a, b, a], 'com um só extra ao alcance, os lasers se revezam entre os dois');
  p.multi = false; p.firing = false; p.target = null; shots.length = 0;
  enemies.length = 0; enemies.push(...all); // de volta os de antes, sem os que nasceram durante o bloco
  for (const e of [a, b, c, d]) { e.hp = e.t.hp; e.hostile = false; }
  put(b, b.hx - 300 + 0, b.hy); put(c, c.hx - 5000 + 0, c.hy); put(d, d.hx - 5000, d.hy - 300);
  save.mods.length = 0; save.mods.push(...keep);
}

// mísseis inimigos: risco de aviso, depois voo reto e rápido; dão mais dano que uma salva de lasers e não são
// teleguiados (quem sai da linha durante o aviso escapa)
{
  reset();
  const all = [...enemies], e = enemies.find(o => o.t.name === 'Raider')!, home = {x: e.hx, y: e.hy};
  enemies.length = 0; enemies.push(e); // só ele no mapa: nada de outros tiros no meio
  const mods0 = [...save.mods]; save.mods.splice(0, save.mods.length, ...mods0.filter(m => MODS[m].type !== 'shield')); // sem escudo regenerando no meio da conta
  const life = () => p.hp + p.sh;
  const duel = (dodge: boolean) => {
    put(e, 3000, 2000); p.x = p.tx = 3400; p.y = p.ty = 2000; p.hp = 1e6; p.sh = 0;
    e.hostile = true; e.mcd = 0; e.cd = 1e9; strikes.length = 0; shots.length = 0; // e.cd: sem lasers, só o míssil
    const hp0 = life();
    frames(1);
    assert(strikes.length === 1 && !strikes[0].live, 'o risco aparece antes do míssil');
    const s = strikes[0];
    assert(s.dmg > e.t.dmg, 'um míssil dói mais que uma salva de lasers');
    if (dodge) { p.y = p.ty = 2000 + 150; } // sai da linha durante o aviso
    for (let i = 0; i < 200 && strikes.length; i++) { e.cd = 1e9; put(e, 3000, 2000); e.hostile = true; e.mcd = 99; frames(1); }
    return hp0 - life();
  };
  const took = duel(false);
  assert.equal(took, Math.round(e.t.dmg * ENEMY_MISSILE.mult), 'parado na linha, leva o míssil');
  assert.equal(duel(true), 0, 'saiu da linha durante o aviso: o míssil passa reto, sem perseguir');
  save.mods.splice(0, save.mods.length, ...mods0);
  enemies.length = 0; enemies.push(...all); e.hostile = false; p.hp = stats().maxHp; p.sh = stats().maxSh; strikes.length = 0;
  put(e, home.x, home.y); // de volta à casa dele, para os blocos seguintes
}

// Dreadnought Prime: ao soltar o primeiro míssil, mira um segundo para onde o jogador desviou
{
  reset();
  const all = [...enemies], e = enemies.find(o => o.t.name === 'Dreadnought Prime')!, home = {x: e.hx, y: e.hy};
  enemies.length = 0; enemies.push(e);
  const mods0 = [...save.mods]; save.mods.splice(0, save.mods.length, ...mods0.filter(m => MODS[m].type !== 'shield'));
  put(e, 3000, 2000); p.x = p.tx = 3400; p.y = p.ty = 2000; p.hp = 1e6; p.sh = 0;
  e.hostile = true; e.mcd = 0; e.cd = 1e9; strikes.length = 0; shots.length = 0;
  frames(1);
  p.y = p.ty = 2150; // desvia do primeiro durante o aviso
  const hp0 = p.hp;
  for (let i = 0; i < 200 && strikes.length; i++) { e.cd = 1e9; e.mcd = 99; put(e, 3000, 2000); e.hostile = true; frames(1); if (strikes.some(s => s.second)) break; }
  const second = strikes.find(s => s.second)!;
  assert(second && !second.live, 'o segundo risco aparece quando o primeiro sai');
  assert(Math.abs(second.a - Math.atan2(150, 400)) < .01, 'e aponta para onde o jogador foi');
  for (let i = 0; i < 200 && strikes.length; i++) { e.cd = 1e9; e.mcd = 99; put(e, 3000, 2000); e.hostile = true; frames(1); }
  assert.equal(hp0 - p.hp, Math.round(e.t.dmg * ENEMY_MISSILE.mult), 'quem ficou parado no lado novo leva o segundo; o primeiro passou longe');
  save.mods.splice(0, save.mods.length, ...mods0);
  enemies.length = 0; enemies.push(...all); e.hostile = false; p.hp = stats().maxHp; p.sh = stats().maxSh; strikes.length = 0;
  put(e, home.x, home.y); // de volta à casa dele, para os blocos seguintes
}

// Leviatã: três ataques de míssil em rodízio. Reto; leque de três (o do meio no jogador); e um teleguiado de curva aberta,
// que acerta quem fica parado mas não vira mais que a curva máxima e se apaga depois de voar o alcance dele
{
  reset();
  const all = [...enemies], b = enemies.find(o => o.t === BOSS)!, home = {x: b.hx, y: b.hy}, H = ENEMY_MISSILE.homing;
  enemies.length = 0; enemies.push(b);
  const mods0 = [...save.mods]; save.mods.splice(0, save.mods.length, ...mods0.filter(m => MODS[m].type !== 'shield'));
  // parado, sem lasers e sem novo míssil; e sozinho no mapa (a reposição repovoa a cada quadro, e os recém-nascidos saem antes de agir)
  const hold = () => { enemies.length = 0; enemies.push(b); b.cd = 1e9; b.mcd = 99; put(b, 3000, 2000); b.hostile = true; };
  const launch = () => { strikes.length = 0; hold(); b.mcd = 0; frames(1); return [...strikes]; };
  p.x = p.tx = 3500; p.y = p.ty = 2000; p.hp = 1e6; p.sh = 0; b.atk = 0;
  const a0 = 0; // jogador bem à direita do chefe
  assert.deepEqual(launch().map(s => [s.homing ?? false, +s.a.toFixed(3)]), [[false, a0]], '1: um reto');
  assert.deepEqual(launch().map(s => +s.a.toFixed(3)), [-ENEMY_MISSILE.cone, a0, ENEMY_MISSILE.cone].map(v => +v.toFixed(3)), '2: leque de três, o do meio no jogador');
  const [h] = launch();
  assert(h.homing && h.speed < ENEMY_MISSILE.speed && strikes.length === 1, '3: um teleguiado, mais lento');
  // parado: o teleguiado acerta
  let hp0 = p.hp;
  for (let i = 0; i < 400 && strikes.length; i++) { hold(); frames(1); }
  assert.equal(hp0 - p.hp, Math.round(BOSS.dmg * ENEMY_MISSILE.mult), 'quem fica parado leva o teleguiado');
  // a curva é limitada: com o jogador aparecendo de repente atrás dele, num quadro ele vira no máximo turn * dt
  b.atk = 2; launch(); for (let i = 0; i < 200 && !strikes[0].live; i++) { hold(); frames(1); }
  const m = strikes[0], before = m.a; p.x = p.tx = m.x - 300; p.y = p.ty = m.y; hold(); update(.05);
  assert(Math.abs(m.a - before) <= H.turn * .05 + 1e-9, 'não vira de uma vez');
  // longe demais para alcançar: voa o alcance dele e se apaga, sem dano
  hp0 = p.hp; p.x = p.tx = 8500; p.y = p.ty = 5500;
  for (let i = 0; i < 800 && strikes.length; i++) { hold(); update(.05); }
  assert(!strikes.length && p.hp === hp0, 'se apagou sem alcançar o jogador');
  // sem escudo, fica furioso: aviso pela metade e o próximo ataque mais cedo; com escudo, volta ao normal
  p.x = p.tx = 3500; p.y = p.ty = 2000; // de volta ao alcance do chefe
  b.atk = 0; b.sh = 0; b.lastHit = Infinity; const [r] = launch(); // lastHit: o escudo não começa a voltar no meio da conta
  assert(Math.abs(r.warn0 - ENEMY_MISSILE.warn * ENEMY_MISSILE.rage.warn) < 1e-9 && b.mcd === ENEMY_MISSILE.rage.cd, 'furioso: aviso curto e rodízio rápido');
  b.sh = BOSS.sh; b.lastHit = -99; const [n] = launch();
  assert(n.warn0 === ENEMY_MISSILE.warn && b.mcd === ENEMY_MISSILE.cd, 'com escudo: normal');
  save.mods.splice(0, save.mods.length, ...mods0);
  enemies.length = 0; enemies.push(...all); b.hostile = false; b.atk = 0; put(b, home.x, home.y);
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; p.hp = stats().maxHp; p.sh = stats().maxSh; strikes.length = 0;
}

// o bico da nave aponta para o alvo enquanto ela o ataca, mesmo voando para outro lado; sem atacar, aponta para onde vai
{
  reset();
  const e = nearest('drone'), aim = () => Math.atan2(e.y - p.y, e.x - p.x), near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6;
  const fly = () => Math.atan2(p.ty - p.y, p.tx - p.x); // direção do voo: rumo ao meio do mapa, longe de qualquer borda
  p.x = e.x + (e.x < M.w / 2 ? 200 : -200); p.y = e.y + (e.y < M.h / 2 ? 150 : -150); // ao lado do alvo, do lado de dentro do mapa
  p.tx = M.w / 2; p.ty = M.h / 2; p.target = e; e.hp = 1e9;
  frames(1);
  assert(near(p.a, fly()) && !near(p.a, aim()), 'lasers desligados: aponta para onde voa');
  p.firing = true; frames(3);
  assert(near(p.a, aim()), 'atacando: aponta para o alvo');
  const flames = parts.filter(q => q.a !== undefined && q.c === stats().flame).slice(-ENGINES[save.ship].length); // as do jogador, pela cor do motor
  assert(flames.length && flames.every(q => near(q.a!, p.a)), 'a chama acompanha para onde a nave está virada');
  p.firing = false; frames(1);
  assert(near(p.a, fly()), 'parou de atacar: volta a apontar para onde voa');
  e.hp = e.t.hp; p.tx = p.x; p.ty = p.y;
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
  put(e, p.x + 200, p.y); e.hostile = false; // pode ter ficado hostil no teste anterior
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
  put(e, BASE.x + BASE.r + 260, BASE.y); e.hp = e.t.hp; e.sh = e.t.sh; e.cd = 0; // logo além da faixa onde inimigo não entra
  p.x = p.tx = BASE.x + BASE.r + 20; p.y = p.ty = BASE.y; p.target = e; p.firing = true; // um passo fora da base
  for (let i = 0; i < 600 && e.hp + e.sh >= e.t.hp + e.t.sh; i++) { p.hp = Math.max(p.hp, 500); frames(1); } // atira até ferir o inimigo (uma salva inteira pode errar)
  assert(e.hp + e.sh < e.t.hp + e.t.sh && e.hostile && p.fight > COMBAT - 2, 'o combate começa ao atirar');
  p.x = p.tx = BASE.x + BASE.r - 30; shots.length = 0; e.cd = 0; p.cd = 0; // volta para dentro da base, ainda mirando e atirando
  const hp0 = p.hp + p.sh, keepM = [...save.mods]; save.mods.push('M1');
  let fired = 0;
  for (let i = 0; i < 200; i++) { p.hp = Math.max(p.hp, 500); p.launch = 0; frames(1); fired += mine().length; } // ~3 s dentro da base, sem morrer
  save.mods.length = 0; save.mods.push(...keepM);
  assert.equal(fired, 0, 'de dentro da base o jogador não atira nem lança mísseis, mesmo em combate');
  p.firing = false; p.target = null;
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
  // fora da base a vida não volta, por mais que o jogador espere; o escudo volta
  p.x = p.tx = BASE.x + 1200; p.y = p.ty = BASE.y + 1200; p.hp = hurt; p.sh = 0; // fora da base, na faixa dos Drones, que não atacam sozinhos
  for (let i = 0; i < 600; i++) { for (const o of enemies) o.hostile = false; update(.05); if (p.hp < hurt) p.hp = hurt; } // 30 s; se alguém acertar, repõe
  assert.equal(p.hp, hurt, 'fora da base a vida não se recupera');
  assert(p.sh > 0 || stats().maxSh === 0, 'o escudo se recupera em qualquer lugar');
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; p.hp = stats().maxHp;
  // o chefe não se recupera ao desistir: a luta contra ele é em várias investidas
  const b = enemies.find(o => o.t === BOSS)!; b.hp = 1000; b.hostile = true; frames(1);
  assert(!b.hostile && b.hp === 1000);
  b.hp = BOSS.hp;
}

// inimigos não chegam perto da base: nem perseguindo o jogador que está logo fora da zona segura, nem vagando
{
  reset();
  const e = nearest('raider');
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y + BASE.r + 30; p.target = null; p.hp = 1e9; // jogador como isca, logo abaixo da zona segura, sem morrer
  put(e, BASE.x - 720, BASE.y); e.hostile = true; // ao lado da base: o caminho reto até o jogador passa por dentro da faixa proibida
  for (let i = 0; i < 1000; i++) { update(.016); for (const o of enemies) assert(Math.hypot(o.x - BASE.x, o.y - BASE.y) >= KEEP_OUT - 1e-6); }
  assert(Math.hypot(e.x - p.x, e.y - p.y) < 300); // contornou a base pela borda e chegou ao jogador
  // casa colada na base, sem nenhum ponto válido em volta para vagar: ele fica parado em casa, e a simulação não trava
  put(e, BASE.x - 720, BASE.y); e.hostile = false; p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; frames(50);
  assert(e.x === BASE.x - 720 && e.y === BASE.y);
  p.hp = stats().maxHp; shots.length = 0;
}

// chefe, no papel: a última nave com tudo Mk3 vence sozinha numa investida, por pouco; a penúltima, igualmente equipada,
// não consegue de uma vez. Mexeu na vida ou no dano do chefe, nas naves ou nos itens Mk3? Esta conta diz se ainda vale.
{
  const duel = (ship: ShipKey) => { // quantas vezes o tempo que a nave aguenta cobre o tempo que ela leva para matar
    const s = SHIPS[ship].slots, acc = Math.min(1, ACCURACY + MODS.A3.val / 100);
    const dps = (s.laser * MODS.L3.val + s.missile * MODS.M3.val / MISSILE_CD) * acc; // lasers + um míssil por recarga
    const burst = s.missile * MISSILE_CHARGES * MODS.M3.val * acc;                    // as cargas que já começam prontas
    const kill = (BOSS.hp + BOSS.sh - burst) / dps, last = (SHIPS[ship].hp + s.shield * MODS.S3.val) / (BOSS.dmg / 1.3); // 1,3 s = ciclo de tiro dos inimigos
    return last / kill;
  };
  const ships = keys(SHIPS), top = ships[ships.length - 1], second = ships[ships.length - 2];
  assert(duel(top) > 1.03 && duel(top) < 1.12, `${top} contra o chefe tem de ser apertado: aguenta ${duel(top).toFixed(2)}x o tempo de matar`);
  assert(duel(second) < 1, `${second} não deveria vencer de uma vez: ${duel(second).toFixed(2)}x`);
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
  // espólio: o chefe deixa um cubo com o chip de dano; passar por cima leva para o inventário
  assert.deepEqual(drops.map(d => d.item), [BOSS_DROP]);
  const inv0 = save.inv.length, cube = drops[0];
  p.x = p.tx = cube.x + PICKUP_R + 40; p.y = p.ty = cube.y; frames(1);
  assert(drops.length === 1 && save.inv.length === inv0, 'de longe não recolhe');
  p.tx = cube.x; for (let i = 0; i < 100 && drops.length; i++) frames(1);
  assert(!drops.length && save.inv.at(-1) === BOSS_DROP && save.inv.length === inv0 + 1, 'recolhido ao passar por cima');
  // o chip de dano: +20% em lasers e mísseis; dois equipados não somam
  { const mods0 = [...save.mods], base0 = stats();
    save.mods.push(save.inv.pop()!);
    assert(stats().boost === 1.2 && stats().dmg === Math.round(base0.dmg * 1.2));
    save.mods.push('C2'); assert.equal(stats().boost, 1.2, 'dois chips de dano não somam');
    assert(keys(SHIPS).every(k => SHIPS[k].slots.chip === 1), 'um chip por nave: Multialvo ou Dano, um de cada vez');
    save.mods.length = 0; save.mods.push(...mods0); }
  p.firing = false; p.target = null; p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; // espera na base, a salvo
  const wait = BOSS_RESPAWN / .05;
  for (let i = 0; i < wait - 20; i++) update(.05);
  assert.equal(bosses().length, 0);
  for (let i = 0; i < 40; i++) update(.05);
  assert.equal(bosses().length, 1);
  p.hp = stats().maxHp; shots.length = 0;
}

// população por faixas: cada tipo tem a cota dele (mix) e vive na faixa de distância dele, os fracos perto da base;
// quem morre é reposto por outro do mesmo tipo, na mesma faixa
{
  reset();
  const count = (t: typeof ENEMIES[number]) => enemies.filter(e => e.t === t).length, fromBase = (e: {hx: number; hy: number}) => Math.hypot(e.hx - BASE.x, e.hy - BASE.y);
  assert.deepEqual(ENEMIES.map(count), M.mix, 'a cota de cada tipo');
  const avg = ENEMIES.map(t => { const l = enemies.filter(e => e.t === t).map(fromBase); return l.reduce((a, b) => a + b, 0) / l.length; });
  for (let i = 1; i < avg.length; i++) assert(avg[i] > avg[i - 1], `tipo ${i} mais longe da base que o ${i - 1}: ${avg.map(Math.round)}`);
  assert(enemies.filter(e => e.t === ENEMIES[0]).every(e => fromBase(e) < 2300), 'os mais fracos nascem perto da base');
  assert(enemies.filter(e => e.t.key === 'dreadnought').every(e => fromBase(e) > 5000), 'os Dreadnoughts nascem longe dela');
  // limpar os fracos perto da base: voltam os mesmos tipos, na mesma faixa
  p.x = p.tx = 3000; p.y = p.ty = 3000;
  for (let i = enemies.length; i--;) if (enemies[i].t === ENEMIES[0]) enemies.splice(i, 1);
  frames(1);
  assert.deepEqual(ENEMIES.map(count), M.mix, 'os destruídos foram repostos pelo mesmo tipo');
  assert(enemies.filter(e => e.t === ENEMIES[0]).every(e => fromBase(e) < 2300));
}
// casa: um inimigo forte atraído em direção à base desiste ao se afastar LEASH de casa, se recupera e volta
{
  reset();
  const e = enemies.find(o => o.t.name === 'Dreadnought')!, h = {x: e.hx, y: e.hy}, dir = Math.atan2(BASE.y - h.y, BASE.x - h.x);
  put(e, h.x, h.y); e.hp = e.t.hp / 2; e.hostile = true;
  let far = 0;
  for (let i = 0; i < 4000; i++) { // o jogador foge na direção da base, sempre 350 à frente dele, como isca
    p.x = p.tx = e.x + Math.cos(dir) * 350; p.y = p.ty = e.y + Math.sin(dir) * 350; p.hp = 1e9;
    update(.05); far = Math.max(far, Math.hypot(e.x - h.x, e.y - h.y));
  }
  const leash = e.t.leash ?? LEASH;
  assert(far > leash * .8 && far < leash + 80, `foi até ${Math.round(far)} de casa`);
  assert(Math.hypot(e.x - BASE.x, e.y - BASE.y) > 3000, 'não chegou nem perto da base');
  assert.equal(e.hp, e.t.hp, 'desistiu e se recuperou');
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; p.hp = stats().maxHp; shots.length = 0; // o jogador some: ele volta para casa e fica por lá
  for (let i = 0; i < 2000; i++) update(.05);
  assert(Math.hypot(e.x - h.x, e.y - h.y) < 600, 'voltou para perto de casa');
  for (const o of enemies) assert(Math.hypot(o.x - o.hx, o.y - o.hy) < (o.t.leash ?? LEASH) + 80, `${o.t.name} longe de casa`);
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

// retomada: o progresso guarda onde a nave estava e como estava, e a hora de cada chefe voltar; recarregar a página
// (resume) não cura, não leva para a base e não ressuscita o chefe antes da hora
{
  reset();
  const boss0 = save.boss, isBoss = () => enemies.some(e => e.t === BOSS);
  p.x = p.tx = 4321; p.y = p.ty = 1234; p.hp = 77; p.sh = 5; persist();
  assert.deepEqual(save.pos, {map: HOME, x: 4321, y: 1234, hp: 77, sh: 5}, 'todo salvamento leva a posição e o estado da nave');
  assert.deepEqual(parseSave(JSON.parse(JSON.stringify(save)))!.pos, save.pos, 'e isso sobrevive a ser gravado e lido');
  assert.equal(parseSave({credits: 0, ship: 'scout', mods: [], pos: {map: 'mapa-que-nao-existe', x: 1, y: 1, hp: 1, sh: 1}})!.pos, undefined);
  save.boss = {[HOME]: Date.now() + 60_000}; // chefe destruído há pouco: só volta daqui a um minuto
  p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; p.hp = stats().maxHp; // "recarrega a página": a nave começaria na base, inteira
  resume();
  assert.deepEqual([p.x, p.y, p.hp, p.sh, world.map], [4321, 1234, 77, 5, HOME], 'volta ao ponto, com a vida e o escudo que tinha');
  frames(5);
  assert(!isBoss() && enemies.length === POPULATION, 'o chefe continua fora até a hora dele');
  save.boss = {[HOME]: Date.now() - 1}; resume(); frames(1);
  assert(isBoss(), 'passada a hora, ele volta');
  save.boss = boss0; p.x = p.tx = BASE.x; p.y = p.ty = BASE.y; p.hp = stats().maxHp; p.sh = stats().maxSh;
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
const FOLDERS = {ships: 'ship', weapons: 'weapon', shields: 'module', engines: 'module', aim: 'module', missiles: 'module', chips: 'module', asteroids: 'rock', bases: 'base'} as const;
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

// conta do piloto (api/pilot.ts), com um Redis de mentira em memória no lugar do Upstash: criar, sessão por cookie,
// gravar e ler o progresso, login com código certo e errado, limite de tentativas, login repetido e cookie forjado
{
  const db = new Map<string, string>();
  const run = ([op, key, a, b]: (string | number)[]) => {
    const k = String(key);
    if (op === 'GET') return db.get(k) ?? null;
    if (op === 'SET') { if (b === 'NX' && db.has(k)) return null; db.set(k, String(a)); return 'OK'; }
    if (op === 'INCR') { db.set(k, String(+(db.get(k) ?? 0) + 1)); return +db.get(k)!; }
    return 1; // EXPIRE
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify((JSON.parse(String(init!.body)) as (string | number)[][]).map(c => ({result: run(c)}))))) as typeof fetch;
  const api = await import('./api/pilot.ts');
  const req = (method: string, body?: unknown, cookie = '') => new Request('https://jogo.test/api/pilot', {method, body: body ? JSON.stringify(body) : undefined, headers: {cookie, 'x-forwarded-for': '1.2.3.4'}});
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];

  assert.equal((await api.GET(req('GET'))).status, 503, 'sem banco e sem segredo: contas indisponíveis, não erro');
  Object.assign(process.env, {KV_REST_API_URL: 'https://redis.test', KV_REST_API_TOKEN: 't', SESSION_SECRET: 'x'.repeat(32)});
  assert.equal(api.pilotId('  Zé  da Órbita!! '), 'ze-da-orbita');
  assert.equal((await api.GET(req('GET'))).status, 401, 'sem sessão');
  assert.equal((await api.POST(req('POST', {action: 'create', login: 'zé', code: 'segredo-longo', save}))).status, 400, 'login curto demais');
  assert.equal((await api.POST(req('POST', {action: 'create', login: 'Zé Piloto', code: 'curto', save}))).status, 400, 'código curto demais');
  const made = await api.POST(req('POST', {action: 'create', login: 'Zé Piloto', code: 'segredo-longo', save: {...save, credits: 777}}));
  assert.equal(made.status, 201); assert.equal((await made.json()).pilot, 'ze-piloto');
  assert(!db.get('pilot:ze-piloto:code')!.includes('segredo-longo'), 'o código nunca vai para o banco, só o hash');
  const jar = cookieOf(made);
  const mine2 = await (await api.GET(req('GET', undefined, jar))).json();
  assert(mine2.pilot === 'ze-piloto' && mine2.save.credits === 777, 'a sessão lê o progresso');
  assert.equal((await api.PUT(req('PUT', {save: {...save, credits: 999}}, jar))).status, 200);
  assert.equal((await (await api.GET(req('GET', undefined, jar))).json()).save.credits, 999);
  assert.equal((await api.PUT(req('PUT', {save: {...save, credits: 5}}))).status, 401, 'sem sessão não grava');
  assert.equal((await api.PUT(req('PUT', {save: 'x'.repeat(20000)}, jar))).status, 400, 'progresso inválido');
  assert.equal((await api.GET(req('GET', undefined, jar.replace(/\w{6}$/, 'abcdef')))).status, 401, 'cookie com assinatura trocada');
  assert.equal((await api.POST(req('POST', {action: 'create', login: 'ze-piloto', code: 'outro-segredo', save}))).status, 409, 'login já em uso');
  const wrong = await api.POST(req('POST', {action: 'login', login: 'Zé Piloto', code: 'errado-errado'}));
  const nobody = await api.POST(req('POST', {action: 'login', login: 'ninguem', code: 'errado-errado'}));
  assert(wrong.status === 401 && nobody.status === 401 && (await wrong.json()).message === (await nobody.json()).message, 'código errado e login inexistente respondem igual');
  const back = await api.POST(req('POST', {action: 'login', login: 'ZÉ PILOTO', code: 'segredo-longo'}));
  assert(back.status === 200 && (await back.json()).save.credits === 999, 'entrar devolve o progresso');
  for (let i = 0; i < 4; i++) await api.POST(req('POST', {action: 'login', login: 'ze-piloto', code: 'errado-errado'}));
  assert.equal((await api.POST(req('POST', {action: 'login', login: 'ze-piloto', code: 'segredo-longo'}))).status, 429, 'depois de 5 tentativas, nem o código certo entra');
  assert((await api.DELETE()).headers.get('set-cookie')!.includes('Max-Age=0'));
  globalThis.fetch = realFetch;
  // o progresso que volta do servidor passa pelo mesmo filtro do progresso local
  assert.equal(parseSave({credits: 5, ship: 'nave-que-nao-existe', mods: []}), null);
  // equipado além do que a nave comporta (save de quando havia dois slots de chip): o excedente vai para o inventário
  assert.deepEqual(parseSave({credits: 0, ship: 'scout', mods: ['L1', 'C1', 'C2', 'L1'], inv: ['S1']}), {credits: 0, ship: 'scout', mods: ['L1', 'C1', 'L1'], owned: ['scout'], inv: ['S1', 'C2'], cargo: {purple: 0, cyan: 0, blue: 0}});
  assert.deepEqual(parseSave({credits: 5, ship: 'scout', mods: ['L1', 'zz'], owned: ['scout'], inv: ['L2', 'xx'], cargo: {purple: 3, ouro: 9}}),
                   {credits: 5, ship: 'scout', mods: ['L1'], owned: ['scout'], inv: ['L2'], cargo: {purple: 3, cyan: 0, blue: 0}});
}

console.log('ok');
