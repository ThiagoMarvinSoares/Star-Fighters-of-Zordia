// Estado do jogo: o que muda durante a partida. A simulação escreve aqui, o desenho só lê.
import { START, SHIPS, MODS, ORES, ACCURACY, MAPS, HOME, PET_LEVELS } from './data.ts';
import type { EnemyDef, MapDef, MapKey, ModKey, ModType, OreKey, ShipKey, NpcKey } from './data.ts';
import type { Vec3 } from './models.ts';

/** offer = a conversa de início está esperando na base; active = cumprindo o objetivo; ready = objetivo cumprido, falta
 *  entregar na base; done = não há mais missão na sequência */
export type QuestStage = 'offer' | 'active' | 'ready' | 'done';
export interface Save {
  credits: number;
  /** nave em uso */
  ship: ShipKey;
  /** naves que o jogador tem no hangar (a em uso está entre elas) */
  owned: ShipKey[];
  /** módulos equipados na nave */
  mods: ModKey[];
  /** módulos comprados e guardados no inventário */
  inv: ModKey[];
  /** minério no porão, por tipo (pode ter fração: o feixe extrai aos poucos) */
  cargo: Record<OreKey, number>;
  /** onde a nave estava, e com quanta vida e escudo, no último salvamento: ao voltar ao jogo ela reaparece ali, do
   *  jeito que estava (recarregar a página não cura nem teleporta para a base) */
  pos?: { map: MapKey; x: number; y: number; hp: number; sh: number };
  /** chefes destruídos: por mapa, o instante (relógio do mundo, em ms) em que cada um volta. Recarregar a página não
   *  traz o chefe de volta antes da hora. */
  boss?: Partial<Record<MapKey, number>>;
  /** missão atual (game/missions.ts): qual, em que fase e quanto do objetivo já foi feito */
  quest?: { id: string; stage: QuestStage; n: number };
  /** missão atual da sequência secundária (oferecida quando a principal termina), no mesmo formato */
  side?: { id: string; stage: QuestStage; n: number };
  /** missão atual da sequência de operações da base (calibração e contratos), oferecida quando o tutorial termina */
  ops?: { id: string; stage: QuestStage; n: number };
  /** missões cuja recompensa já foi paga: refazer uma delas (menu de missões) não paga de novo */
  paid?: string[];
  /** do tutorial antigo, de antes das missões: só lidos uma vez, para continuar do mesmo ponto (ver game/missions.ts) */
  tut?: number; tutN?: number;
  /** a ficha de cada P.E.T. (experiência e nome): mods[j] é a do j-ésimo P.E.T. de mods, na ordem da lista, e o mesmo
   *  para inv. Quem move itens entre as listas (as funções do hangar, abaixo) move a ficha junto. */
  petInfo?: { mods: PetInfo[]; inv: PetInfo[] };
}
/** um P.E.T. do jogador: experiência (data.ts, PET_LEVELS) e o nome que o jogador deu ('' = sem nome) */
export interface PetInfo { xp: number; name: string }
export const PET_NAME = 16;
/** limpa um nome de P.E.T. vindo do jogador ou do progresso salvo: sem caracteres de controle, no máximo PET_NAME letras */
export const petName = (s: unknown) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, PET_NAME) : '';
export interface Stats {
  maxHp: number; maxSh: number; dmg: number; speed: number;
  /** chance de cada tiro acertar, de 0 a 1 */
  acc: number;
  /** minério por segundo do feixe (0 = sem minerador) e tamanho do porão */
  mine: number; cargo: number;
  /** nível do melhor minerador equipado (0 = nenhum): diz quais minérios dá para extrair */
  mineLevel: number;
  /** alvos além do principal que o chip de múltiplos alvos permite (0 = sem chip) */
  multi: number;
  /** multiplicador do dano de lasers e mísseis (1 = normal; 1.2 com o chip de dano). dmg já vem multiplicado. */
  boost: number; slots: Record<ModType, number>; r: number;
  /** robô de reparo: % do casco recuperado por segundo fora de combate, em qualquer lugar (0 = sem robô) */
  repair: number;
  /** cor da aura do escudo e da chama do motor: a do melhor módulo equipado de cada tipo */
  aura: string; flame: string;
}

/** o que jogador e inimigos têm em comum */
export interface Body {
  x: number; y: number;
  /** direção, em radianos */
  a: number;
  hp: number; sh: number;
  /** tempo até o próximo disparo */
  cd: number;
  /** quando levou dano pela última vez (relógio do jogo) */
  lastHit: number;
}
export interface Player extends Body {
  /** destino do movimento */
  tx: number; ty: number;
  target: Enemy | null;
  firing: boolean; auto: boolean;
  /** múltiplos alvos ligado (só faz efeito com o chip equipado); extra = os alvos além do principal, neste quadro */
  multi: boolean; extra: Enemy[];
  /** quando atirou pela última vez (relógio do jogo), e quantos segundos de combate ainda restam (0 = fora de combate) */
  lastShot: number; fight: number;
  /** pedido de lançar um míssil (barra de atalhos): qual dos mísseis equipados, 0 = o primeiro; a simulação atende e apaga */
  launch: number | null;
  /** robô de reparo: fix = pedido de consertar já (barra de atalhos), que a simulação atende e apaga; fixAt = quando foi
   *  o último pedido; fixing = está consertando neste quadro */
  fix: boolean; fixAt: number; fixing: boolean;
  /** um por míssil equipado, na ordem em que estão na nave: n = cargas prontas, t = segundos até a próxima voltar.
   *  mleft = o próximo míssil sai do lado esquerdo da nave. */
  mis: { n: number; t: number }[]; mleft: boolean;
  /** asteroide escolhido para minerar (clique), e se o feixe está ligado neste quadro */
  mining: Rock | null; beam: boolean;
  deaths: number;
}
export interface Enemy extends Body {
  t: EnemyDef;
  /** ponto para onde está vagando */
  wx: number; wy: number;
  /** casa: onde nasceu. Ele vaga em volta dela e não se afasta mais que LEASH. back = voltando para casa, sem dar
   *  atenção ao jogador. */
  hx: number; hy: number; back: boolean;
  hostile: boolean;
  /** segundos até poder lançar o próximo míssil (só quem tem EnemyDef.missile); atk = vez de qual ataque do rodízio */
  mcd: number; atk: number;
}
/** Míssil inimigo: enquanto warn > 0 é só o risco de aviso, saindo de quem atira (x, y acompanham o inimigo) na direção
 *  a, com len de comprimento; depois (live) voa reto por essa linha. flown = quanto já percorreu. */
export interface Strike { src: Enemy; a: number; len: number; warn: number; /** quanto o aviso durava ao começar */ warn0: number; dmg: number; x: number; y: number; flown: number; live: boolean;
  /** velocidade de voo; homing = teleguiado (vira para o jogador, até a curva máxima) */
  speed: number; homing?: boolean;
  /** é o segundo míssil de quem tem EnemyDef.followUp (não puxa um terceiro) */
  second?: boolean }
/** espólio no mapa (cubo): passar por cima recolhe o item para o inventário */
export interface Drop { x: number; y: number; item: ModKey }
/** asteroide: parado no mapa, some quando o minério (left) acaba */
export interface Rock { ore: OreKey; x: number; y: number; a: number; r: number; left: number }
/** um NPC no mapa atual (MapDef.npcs): onde está, para onde aponta e a próxima parada da rota */
export interface Npc { id: NpcKey; x: number; y: number; a: number; next: number }
/** um P.E.T. em voo (módulo mod, do tipo 'pet'), h acima do plano; hp 0 = fora (desequipado, ou acabou de trocar de mapa
 *  ou de renascer: reaparece já no lugar) */
export interface Pet { x: number; y: number; a: number; h: number; hp: number; mod: ModKey }
export interface Shot {
  src: Player | Enemy | Pet; tgt: Player | Enemy;
  /** raio da nave que atirou e ponto de fixação de onde sai */
  r: number; hard: Vec3;
  dmg: number; c: string;
  /** laser do jogador que disparou (define o som) */
  mod?: ModKey;
  /** segundos até sair do cano; live = já está voando */
  delay: number; live: boolean;
  x: number; y: number; a: number;
  /** altura do cano acima do plano */
  h: number;
  /** míssil: voa devagar, deixa rastro e explode ao chegar */
  missile?: boolean;
  /** míssil de uma salva de vários: faixa em que ele voa, em distância para o lado da linha até o alvo (com sinal) */
  lane?: number;
  /** tiro que vai errar: passa a esta distância do alvo e some sem causar dano */
  off?: { x: number; y: number };
}
export interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; r: number; c: string; ring?: boolean; /** altura acima do plano */ h?: number;
  /** chamas: para onde aponta quem a soltou (o desenho usa para saber se ela fica à frente ou atrás do casco) */ a?: number }
export interface FloatText { x: number; y: number; s: string; c: string; t: number }

// descarta módulos desconhecidos ou que passam do limite do tipo na nave
export const trim = (mods: unknown[], ship: ShipKey): ModKey[] => {
  const n: Record<ModType, number> = {laser: 0, shield: 0, engine: 0, aim: 0, missile: 0, mining: 0, chip: 0, repair: 0, pet: 0};
  return mods.filter((m): m is ModKey =>
    typeof m === 'string' && Object.hasOwn(MODS, m) && ++n[MODS[m as ModKey].type] <= SHIPS[ship].slots[MODS[m as ModKey].type]);
};

// porão zerado, ou com o que veio de um save (só tipos de minério conhecidos e quantidades válidas)
function emptyCargo(from?: unknown): Record<OreKey, number> {
  const c = {} as Record<OreKey, number>, f = (from ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(ORES) as OreKey[]) c[k] = typeof f[k] === 'number' && f[k] > 0 ? f[k] : 0;
  return c;
}
// progresso salvo no navegador (créditos, nave, módulos, carga). OLD_SAVE_KEY é a chave de quando o jogo se chamava
// Nebula Raiders: quem já tinha progresso continua de onde parou, e o próximo salvamento grava na chave nova.
const SAVE_KEY = 'star-fighters-of-zordia', OLD_SAVE_KEY = 'nebula-raiders';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const okQuest = (q: any) => !!q && typeof q.id === 'string' && ['offer', 'active', 'ready', 'done'].includes(q.stage) && Number.isFinite(q.n);
/** Confere um progresso vindo de fora (do navegador ou da conta do piloto) e devolve só o que o jogo conhece;
 *  null se não serve. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSave(s: any): Save | null {
    if (s && Object.hasOwn(SHIPS, s.ship) && Array.isArray(s.mods) && s.credits >= 0) {
      // Módulos equipados além do que a nave comporta hoje (um save de quando ela tinha mais slots daquele tipo) não se
      // perdem: vão para o inventário.
      const mods = trim(s.mods, s.ship), left = [...mods];
      const spare: ModKey[] = [];
      // ficha dos P.E.T.s: acompanha cada um, inclusive os que vão para o inventário
      const px = s.petInfo && typeof s.petInfo === 'object' ? s.petInfo : {};
      const xp = (l: unknown, j: number): PetInfo => { const o = Array.isArray(l) && l[j] && typeof l[j] === 'object' ? l[j] : {};
                                                      return {xp: Number.isFinite(o.xp) && o.xp > 0 ? +o.xp : 0, name: petName(o.name)}; };
      const modsXp: PetInfo[] = [], spareXp: PetInfo[] = [];
      let pj = 0;
      for (const m of s.mods as unknown[]) if (typeof m === 'string' && Object.hasOwn(MODS, m)) {
        const i = left.indexOf(m as ModKey), pet = MODS[m as ModKey].type === 'pet';
        if (i >= 0) { left.splice(i, 1); if (pet) modsXp.push(xp(px.mods, pj)); }
        else { spare.push(m as ModKey); if (pet) spareXp.push(xp(px.mods, pj)); } // o que trim deixou de fora
        if (pet) pj++;
      }
      const inv: ModKey[] = Array.isArray(s.inv) ? s.inv.filter((m: unknown) => typeof m === 'string' && Object.hasOwn(MODS, m)) : [];
      const invXp = [...inv.filter(m => MODS[m].type === 'pet').map((_, j) => xp(px.inv, j)), ...spareXp];
      return {credits: +s.credits, ship: s.ship, mods,
              // save antigo (sem lista de naves): fica com a atual e as mais baratas que ela
              owned: Array.isArray(s.owned) ? [...new Set<ShipKey>([s.ship, ...s.owned.filter((k: unknown) => typeof k === 'string' && Object.hasOwn(SHIPS, k))])]
                                            : (Object.keys(SHIPS) as ShipKey[]).filter(k => SHIPS[k].cost <= SHIPS[s.ship as ShipKey].cost),
              inv: [...inv, ...spare],
              ...([...modsXp, ...invXp].some(o => o.xp || o.name) && {petInfo: {mods: modsXp, inv: invXp}}),
              cargo: emptyCargo(s.cargo),
              ...(s.pos && Object.hasOwn(MAPS, s.pos.map) && [s.pos.x, s.pos.y, s.pos.hp, s.pos.sh].every(Number.isFinite)
                  && {pos: {map: s.pos.map, x: +s.pos.x, y: +s.pos.y, hp: +s.pos.hp, sh: +s.pos.sh}}),
              ...(s.boss && typeof s.boss === 'object'
                  && {boss: Object.fromEntries(Object.entries(s.boss).filter(([k, v]) => Object.hasOwn(MAPS, k) && Number.isFinite(v)))}),
              ...(okQuest(s.quest) && {quest: {id: s.quest.id, stage: s.quest.stage, n: +s.quest.n}}),
              ...(okQuest(s.side) && {side: {id: s.side.id, stage: s.side.stage, n: +s.side.n}}),
              ...(okQuest(s.ops) && {ops: {id: s.ops.id, stage: s.ops.stage, n: +s.ops.n}}),
              ...(Array.isArray(s.paid) && {paid: s.paid.filter((k: unknown) => typeof k === 'string').slice(0, 200)}),
              ...(Number.isInteger(s.tut) && s.tut >= 0 && {tut: s.tut}), ...(Number.isInteger(s.tutN) && s.tutN >= 0 && {tutN: s.tutN})};
    }
  return null;
}
function load(): Save {
  try { const got = parseSave(JSON.parse(localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(OLD_SAVE_KEY) ?? 'null')); if (got) return got; } catch {}
  return {credits: START.credits, ship: START.ship, owned: [START.ship], mods: [...START.mods], inv: [], cargo: emptyCargo()};
}
export const save = load();
// todo salvamento leva junto onde a nave está e como está (ver Save.pos)
const store = () => {
  save.pos = {map: world.map, x: p.x, y: p.y, hp: p.hp, sh: p.sh};
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
};
/** avisados a cada salvamento (a conta do piloto usa para mandar o progresso ao servidor) */
export const onPersist: (() => void)[] = [];
export const persist = () => { store(); for (const f of onPersist) f(); };
// fechar ou recarregar a aba no meio de um feixe não perde o minério já extraído (a simulação só salva quando ele desliga)
if (typeof addEventListener === 'function') addEventListener('pagehide', persist);

/** o melhor módulo equipado de um tipo (o de maior valor), se houver */
export const best = (type: ModType): ModKey | undefined => save.mods.filter(m => MODS[m].type === type).sort((a, b) => MODS[b].val - MODS[a].val)[0];
export const count = (type: ModType) => save.mods.filter(m => MODS[m].type === type).length;
// atributos da nave atual somados aos módulos equipados
export function stats(): Stats {
  const s = SHIPS[save.ship], t: Record<ModType, number> = {laser: 0, shield: 0, engine: 0, aim: 0, missile: 0, mining: 0, chip: 0, repair: 0, pet: 0};
  for (const m of save.mods) t[MODS[m].type] += MODS[m].val;
  const chips = save.mods.map(m => MODS[m]).filter(m => m.type === 'chip');
  const multi = chips.filter(m => m.chip === 'multi').reduce((a, m) => a + m.val, 0);
  const boost = 1 + Math.max(0, ...chips.filter(m => m.chip === 'damage').map(m => m.val)) / 100; // o maior vale; não somam
  const color = (type: ModType) => { const k = best(type); return k && MODS[k].color || '#66ccff'; };
  return {maxHp: s.hp, maxSh: t.shield, dmg: Math.round(t.laser * boost), speed: s.speed + t.engine, acc: Math.min(1, ACCURACY + t.aim / 100), mine: t.mining, cargo: s.cargo, mineLevel: Math.max(0, ...save.mods.map(m => MODS[m].level ?? 0)), multi, boost, repair: save.mods.reduce((a, k) => a + (MODS[k].type !== 'repair' ? 0 : MODS[k].flat ? MODS[k].val / s.hp * 100 : MODS[k].val), 0), slots: s.slots, r: s.r, aura: color('shield'), flame: color('engine')};
}

/** a nave está na zona segura de uma base? (só lá se compra, vende e equipa; mapa sem base não tem isso) */
export const atBase = () => { const b = map().base; return !!b && Math.hypot(p.x - b.x, p.y - b.y) < b.r; };
/** em que mapa o jogador está; tudo que depende do mapa lê map() */
export const world: { map: MapKey } = {map: HOME};
export const map = (): MapDef => MAPS[world.map];

const SPAWN = MAPS[HOME].spawn;
export const p: Player = {x: SPAWN.x, y: SPAWN.y, tx: SPAWN.x, ty: SPAWN.y, a: -Math.PI / 2, hp: stats().maxHp, sh: stats().maxSh,
                          target: null, firing: false, auto: false, multi: false, extra: [], launch: null, fix: false, fixAt: -99, fixing: false, mis: [], mleft: true, mining: null, beam: false, cd: 0, lastHit: -99, lastShot: -99, fight: 0, deaths: 0};
// ---------- fichas dos P.E.T.s (experiência e nome) ----------
type From = 'mods' | 'inv';
const isPet = (k: ModKey) => MODS[k].type === 'pet';
const blank = (): PetInfo => ({xp: 0, name: ''});
/** a ficha do j-ésimo P.E.T. da lista from (criada vazia se faltar) */
const info = (from: From, j: number) => (save.petInfo ??= {mods: [], inv: []})[from][j] ??= blank();
const nth = (from: From, i: number) => save[from].slice(0, i).filter(isPet).length;
/** nível (índice em PET_LEVELS: 0 = nível 1) para uma experiência */
export const levelOf = (xp: number) => PET_LEVELS.filter(l => xp >= l.xp).length - 1;
/** a ficha do item i da lista from (undefined se não for um P.E.T.) */
export const petAt = (from: From, i: number): PetInfo | undefined => { const k = save[from][i]; return k && isPet(k) ? save.petInfo?.[from][nth(from, i)] ?? blank() : undefined; };
/** a ficha do j-ésimo P.E.T. equipado (os P.E.T.s em voo, pets[j]) */
export const flying = (j: number): PetInfo => save.petInfo?.mods[j] ?? blank();
/** como um P.E.T. é chamado na tela: o nome que o jogador deu, ou "P.E.T." */
export const petLabel = (o: PetInfo) => o.name || 'P.E.T.';
/** dá nome ao P.E.T. que está no item i da lista from (vazio = volta a ser só "P.E.T."). Vale em qualquer lugar. */
export function renamePet(from: From, i: number, name: string) {
  const k = save[from][i];
  if (!k || !isPet(k)) return false;
  info(from, nth(from, i)).name = petName(name); persist();
  return true;
}
/** Experiência para os P.E.T.s equipados (inimigo destruído, missão entregue): cada um ganha n. Quem sobe de nível, avisa. */
export function petXp(n: number) {
  const l = save.mods.filter(isPet);
  if (!n || !l.length) return;
  l.forEach((_, j) => {
    const o = info('mods', j), was = levelOf(o.xp);
    o.xp += n;
    if (levelOf(o.xp) > was) texts.push({x: p.x, y: p.y - 50 - 18 * j, s: `${o.name || 'P.E.T.' + (l.length > 1 ? ' ' + (j + 1) : '')} subiu para o nível ${levelOf(o.xp) + 1}!`, c: '#8f8', t: 3});
  });
}
// tirar e pôr um item numa lista, levando a ficha junto quando é um P.E.T.
function take(from: From, i: number) {
  const k = save[from][i], o = isPet(k) ? save.petInfo?.[from].splice(nth(from, i), 1)[0] ?? blank() : blank();
  save[from].splice(i, 1);
  return {k, o};
}
function put(to: From, k: ModKey, o = blank()) { if (isPet(k)) (save.petInfo ??= {mods: [], inv: []})[to][save[to].filter(isPet).length] = o; save[to].push(k); }
/** os P.E.T.s em voo, um por P.E.T. equipado, na ordem da nave (sim.ts) */
export const pets: Pet[] = [];
export const rocks: Rock[] = [], drops: Drop[] = [], strikes: Strike[] = [], npcs: Npc[] = [];
/** Troca o progresso atual pelo que veio de fora (o da conta, ao entrar) e conserta a nave para ele; false se não serve.
 *  Grava no navegador, mas não avisa onPersist: o servidor acabou de mandar esse mesmo progresso. */
export function adopt(raw: unknown) {
  const got = parseSave(raw);
  if (!got) return false;
  delete save.pos; delete save.boss; delete save.quest; delete save.side; delete save.ops; delete save.paid; // o que o progresso novo não trouxer não pode sobrar do antigo
  Object.assign(save, got);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} // sem passar por store(): a posição é a do progresso, não a de agora
  const st = stats(); p.hp = st.maxHp; p.sh = st.maxSh; // quem chama segue com resume() (sim.ts), que põe a nave onde ela estava
  return true;
}
/** apaga o progresso guardado neste navegador (ao sair de uma conta: ele continua no servidor) */
export const forget = () => { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_SAVE_KEY); } catch {} };
export const enemies: Enemy[] = [], shots: Shot[] = [], texts: FloatText[] = [], parts: Particle[] = [];

// ---------- hangar: comprar, vender, equipar (as regras; a tela fica em hangar.ts) ----------
// Toda operação devolve false, sem mudar nada, quando não é permitida. Nenhuma é permitida fora da zona segura de uma
// base (atBase): a regra mora aqui, e a tela (hangar.ts) só a consulta para desligar botões e dizer o motivo.
const settle = () => { const st = stats(); p.hp = Math.min(p.hp, st.maxHp); p.sh = Math.min(p.sh, st.maxSh); persist(); };
export const freeSlot = (type: ModType) => count(type) < SHIPS[save.ship].slots[type];
/** avisados a cada módulo comprado (as missões usam, para objetivos do tipo "compre um laser") */
export const onBought: ((k: ModKey) => void)[] = [];
const bought = (k: ModKey) => { for (const f of onBought) f(k); };
/** compra um módulo: vai direto para a nave se houver slot livre do tipo, senão fica no inventário */
export function buyMod(k: ModKey) {
  if (!atBase() || save.credits < MODS[k].cost) return false;
  save.credits -= MODS[k].cost; put(freeSlot(MODS[k].type) ? 'mods' : 'inv', k); bought(k); settle();
  return true;
}
/** dá um módulo de presente (missão): vai para a nave se houver slot livre do tipo, senão para o inventário */
export function giveMod(k: ModKey) { put(freeSlot(MODS[k].type) ? 'mods' : 'inv', k); settle(); }
/** vende por metade do preço o módulo i da nave ('mods') ou do inventário ('inv') */
export function sellMod(from: 'mods' | 'inv', i: number) {
  const k = save[from][i];
  if (!atBase() || !k) return false;
  take(from, i); save.credits += MODS[k].cost / 2; settle();
  return true;
}
/** inventário -> nave, se houver slot livre do tipo */
export function equip(i: number) {
  const k = save.inv[i];
  if (!atBase() || !k || !freeSlot(MODS[k].type)) return false;
  const it = take('inv', i); put('mods', it.k, it.o); settle();
  return true;
}
/** nave -> inventário */
export function unequip(i: number) {
  const k = save.mods[i];
  if (!atBase() || !k) return false;
  const it = take('mods', i); put('inv', it.k, it.o); settle();
  return true;
}
/** passa a usar outra nave do hangar; os módulos da nave que estava em uso vão todos para o inventário */
export function useShip(k: ShipKey) {
  if (!atBase() || k === save.ship || !save.owned.includes(k)) return false;
  while (save.mods.length) { const it = take('mods', 0); put('inv', it.k, it.o); }
  save.ship = k; settle();
  return true;
}
/** compra uma nave que o jogador ainda não tem e já passa a usá-la (as outras continuam no hangar) */
export function buyShip(k: ShipKey) {
  if (!atBase() || SHIPS[k].soon || save.owned.includes(k) || save.credits < SHIPS[k].cost) return false;
  save.credits -= SHIPS[k].cost; save.owned.push(k);
  return useShip(k);
}

// ---------- carga ----------
/** minério no porão, somando todos os tipos */
export const cargoUsed = () => Object.values(save.cargo).reduce((a, b) => a + b, 0);
/** quanto a carga vale: só unidades inteiras de cada minério contam */
export const cargoValue = () => (Object.keys(ORES) as OreKey[]).reduce((v, k) => v + Math.floor(save.cargo[k]) * ORES[k].price, 0);
/** vende até n unidades inteiras de um minério, só na base; devolve os créditos recebidos, 0 se nada foi vendido */
export function sellOre(k: OreKey, n: number) {
  n = Math.min(Math.floor(n), Math.floor(save.cargo[k])); // a fração fica no porão
  if (!atBase() || !(n > 0)) return 0;
  save.cargo[k] -= n; save.credits += n * ORES[k].price; persist();
  return n * ORES[k].price;
}
/** vende toda a carga; devolve os créditos recebidos */
export const sellCargo = () => (Object.keys(ORES) as OreKey[]).reduce((v, k) => v + sellOre(k, save.cargo[k]), 0);

/** O que aconteceu no último quadro da simulação. Ela só registra; quem toca som (audio.ts) lê daqui. */
export type GameEvent =
  | { kind: 'shot'; /** lançamento de míssil inimigo (o som é o de míssil) */ missile?: boolean; x: number; y: number; /** altura do cano e cor do tiro (para o clarão do disparo) */ h: number; c: string; /** tiro do jogador (senão, de inimigo) */ mine: boolean; /** laser que disparou, nos tiros do jogador */ mod?: ModKey }
  | { kind: 'hit'; x: number; y: number; /** onde o tiro estava ao acertar, e a altura dele (para o clarão do impacto) */ at: { x: number; y: number; h: number }; /** direção em que o tiro vinha */ a: number; /** acertou o jogador */ onPlayer: boolean; /** o escudo absorveu (senão, pegou no casco) */ shielded: boolean }
  | { kind: 'boom'; x: number; y: number; /** raio da nave que explodiu */ r: number };
export const events: GameEvent[] = [];

export const mouse = {x: 0, y: 0, held: false}; // escrito por input.ts
/** tela: tamanho em pixels CSS e pixels reais por pixel CSS (escritos por main.ts); zoom da câmera sobre a nave (roda do mouse, input.ts) */
export const view = {w: 1280, h: 720, dpr: 1, zoom: 1};
