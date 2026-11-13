// Estado do jogo: o que muda durante a partida. A simulação escreve aqui, o desenho só lê.
import { START, SHIPS, MODS, ORES, ACCURACY, MAPS, HOME } from './data.ts';
import type { EnemyDef, MapDef, MapKey, ModKey, ModType, OreKey, ShipKey } from './data.ts';
import type { Vec3 } from './models.ts';

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
}
export interface Stats {
  maxHp: number; maxSh: number; dmg: number; speed: number;
  /** chance de cada tiro acertar, de 0 a 1 */
  acc: number;
  /** minério por segundo do feixe (0 = sem minerador) e tamanho do porão */
  mine: number; cargo: number; slots: Record<ModType, number>; r: number;
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
  /** quando atirou pela última vez (relógio do jogo), e quantos segundos de combate ainda restam (0 = fora de combate) */
  lastShot: number; fight: number;
  /** pedido de lançar os mísseis (barra de atalhos); a simulação atende e apaga */
  launch: boolean;
  /** tempo até poder lançar mísseis de novo */
  mcd: number;
  /** asteroide escolhido para minerar (clique), e se o feixe está ligado neste quadro */
  mining: Rock | null; beam: boolean;
  deaths: number;
}
export interface Enemy extends Body {
  t: EnemyDef;
  /** ponto para onde está vagando */
  wx: number; wy: number;
  hostile: boolean;
}
/** asteroide: parado no mapa, some quando o minério (left) acaba */
export interface Rock { ore: OreKey; x: number; y: number; a: number; r: number; left: number }
export interface Shot {
  src: Player | Enemy; tgt: Player | Enemy;
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
  /** tiro que vai errar: passa a esta distância do alvo e some sem causar dano */
  off?: { x: number; y: number };
}
export interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; r: number; c: string; ring?: boolean; /** altura acima do plano */ h?: number;
  /** chamas: para onde aponta quem a soltou (o desenho usa para saber se ela fica à frente ou atrás do casco) */ a?: number }
export interface FloatText { x: number; y: number; s: string; c: string; t: number }

// descarta módulos desconhecidos ou que passam do limite do tipo na nave
export const trim = (mods: unknown[], ship: ShipKey): ModKey[] => {
  const n: Record<ModType, number> = {laser: 0, shield: 0, engine: 0, aim: 0, missile: 0, mining: 0};
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
/** Confere um progresso vindo de fora (do navegador ou da conta do piloto) e devolve só o que o jogo conhece;
 *  null se não serve. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSave(s: any): Save | null {
    if (s && Object.hasOwn(SHIPS, s.ship) && Array.isArray(s.mods) && s.credits >= 0)
      return {credits: +s.credits, ship: s.ship, mods: trim(s.mods, s.ship),
              // save antigo (sem lista de naves): fica com a atual e as mais baratas que ela
              owned: Array.isArray(s.owned) ? [...new Set<ShipKey>([s.ship, ...s.owned.filter((k: unknown) => typeof k === 'string' && Object.hasOwn(SHIPS, k))])]
                                            : (Object.keys(SHIPS) as ShipKey[]).filter(k => SHIPS[k].cost <= SHIPS[s.ship as ShipKey].cost),
              inv: Array.isArray(s.inv) ? s.inv.filter((m: unknown) => typeof m === 'string' && Object.hasOwn(MODS, m)) : [],
              cargo: emptyCargo(s.cargo)};
  return null;
}
function load(): Save {
  try { const got = parseSave(JSON.parse(localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(OLD_SAVE_KEY) ?? 'null')); if (got) return got; } catch {}
  return {credits: START.credits, ship: START.ship, owned: [START.ship], mods: [...START.mods], inv: [], cargo: emptyCargo()};
}
export const save = load();
const store = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
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
  const s = SHIPS[save.ship], t: Record<ModType, number> = {laser: 0, shield: 0, engine: 0, aim: 0, missile: 0, mining: 0};
  for (const m of save.mods) t[MODS[m].type] += MODS[m].val;
  const color = (type: ModType) => { const k = best(type); return k && MODS[k].color || '#66ccff'; };
  return {maxHp: s.hp, maxSh: t.shield, dmg: t.laser, speed: s.speed + t.engine, acc: Math.min(1, ACCURACY + t.aim / 100), mine: t.mining, cargo: s.cargo, slots: s.slots, r: s.r, aura: color('shield'), flame: color('engine')};
}

/** a nave está na zona segura de uma base? (só lá se compra, vende e equipa; mapa sem base não tem isso) */
export const atBase = () => { const b = map().base; return !!b && Math.hypot(p.x - b.x, p.y - b.y) < b.r; };
/** em que mapa o jogador está; tudo que depende do mapa lê map() */
export const world: { map: MapKey } = {map: HOME};
export const map = (): MapDef => MAPS[world.map];

const SPAWN = MAPS[HOME].spawn;
export const p: Player = {x: SPAWN.x, y: SPAWN.y, tx: SPAWN.x, ty: SPAWN.y, a: -Math.PI / 2, hp: stats().maxHp, sh: stats().maxSh,
                          target: null, firing: false, auto: false, launch: false, mcd: 0, mining: null, beam: false, cd: 0, lastHit: -99, lastShot: -99, fight: 0, deaths: 0};
export const rocks: Rock[] = [];
/** Troca o progresso atual pelo que veio de fora (o da conta, ao entrar) e conserta a nave para ele; false se não serve.
 *  Grava no navegador, mas não avisa onPersist: o servidor acabou de mandar esse mesmo progresso. */
export function adopt(raw: unknown) {
  const got = parseSave(raw);
  if (!got) return false;
  Object.assign(save, got); store();
  const st = stats(); p.hp = st.maxHp; p.sh = st.maxSh;
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
/** compra um módulo: vai direto para a nave se houver slot livre do tipo, senão fica no inventário */
export function buyMod(k: ModKey) {
  if (!atBase() || save.credits < MODS[k].cost) return false;
  save.credits -= MODS[k].cost; (freeSlot(MODS[k].type) ? save.mods : save.inv).push(k); settle();
  return true;
}
/** vende por metade do preço o módulo i da nave ('mods') ou do inventário ('inv') */
export function sellMod(from: 'mods' | 'inv', i: number) {
  const k = save[from][i];
  if (!atBase() || !k) return false;
  save[from].splice(i, 1); save.credits += MODS[k].cost / 2; settle();
  return true;
}
/** inventário -> nave, se houver slot livre do tipo */
export function equip(i: number) {
  const k = save.inv[i];
  if (!atBase() || !k || !freeSlot(MODS[k].type)) return false;
  save.inv.splice(i, 1); save.mods.push(k); settle();
  return true;
}
/** nave -> inventário */
export function unequip(i: number) {
  const k = save.mods[i];
  if (!atBase() || !k) return false;
  save.mods.splice(i, 1); save.inv.push(k); settle();
  return true;
}
/** passa a usar outra nave do hangar; os módulos da nave que estava em uso vão todos para o inventário */
export function useShip(k: ShipKey) {
  if (!atBase() || k === save.ship || !save.owned.includes(k)) return false;
  save.inv.push(...save.mods.splice(0)); save.ship = k; settle();
  return true;
}
/** compra uma nave que o jogador ainda não tem e já passa a usá-la (as outras continuam no hangar) */
export function buyShip(k: ShipKey) {
  if (!atBase() || save.owned.includes(k) || save.credits < SHIPS[k].cost) return false;
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
  | { kind: 'shot'; x: number; y: number; /** altura do cano e cor do tiro (para o clarão do disparo) */ h: number; c: string; /** tiro do jogador (senão, de inimigo) */ mine: boolean; /** laser que disparou, nos tiros do jogador */ mod?: ModKey }
  | { kind: 'hit'; x: number; y: number; /** onde o tiro estava ao acertar, e a altura dele (para o clarão do impacto) */ at: { x: number; y: number; h: number }; /** direção em que o tiro vinha */ a: number; /** acertou o jogador */ onPlayer: boolean; /** o escudo absorveu (senão, pegou no casco) */ shielded: boolean }
  | { kind: 'boom'; x: number; y: number; /** raio da nave que explodiu */ r: number };
export const events: GameEvent[] = [];

export const mouse = {x: 0, y: 0, held: false}; // escrito por input.ts
/** tela: tamanho em pixels CSS e pixels reais por pixel CSS (escritos por main.ts); zoom da câmera sobre a nave (roda do mouse, input.ts) */
export const view = {w: 1280, h: 720, dpr: 1, zoom: 1};
