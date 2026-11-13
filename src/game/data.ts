// Dados do jogo: todo o balanceamento mora aqui. Sem lógica.
// Os mapas ficam no fim do arquivo (MAPS): tamanho, base, inimigos, chefe e portais de cada um.
/** raio da estação da base, no mesmo sentido do r das naves (o modelo 3D mede 1,5x isso) */
export const STATION_R = 130;
export const RANGE = 600, SHOT_SPEED = 1100;
/** chance de um tiro do jogador (laser ou míssil) acertar sem computador de mira (0 a 1); os módulos de mira somam pontos percentuais */
export const ACCURACY = .75;
/** mísseis: segundos entre lançamentos e velocidade de voo (bem mais lentos que o laser; erram com a mesma chance) */
export const MISSILE_CD = 6, MISSILE_SPEED = 450;
/** raio do míssil em voo, na escala das naves: o modelo mede 3x isso de comprimento, com o centro na posição do tiro */
export const MISSILE_R = 11;
/** inimigos ficam a esta distância além da zona segura de uma base: com folga, e nunca voam por cima dela */
export const KEEP_MARGIN = 250;
/** raio de um portal: encostar nele leva a nave para outro mapa */
export const PORTAL_R = 70;
/** inimigos não renascem a menos disto do jogador: a área que ele limpou fica vazia enquanto ele estiver nela */
export const CLEAR = 1400;

export type ModType = 'laser' | 'shield' | 'engine' | 'aim' | 'missile' | 'mining';
export type ShipKey = 'scout' | 'corvette' | 'cruiser' | 'interceptor';
export type ModKey = 'L1' | 'L2' | 'L3' | 'S1' | 'S2' | 'S3' | 'E1' | 'E2' | 'A1' | 'A2' | 'A3' | 'M1' | 'M2' | 'M3' | 'M4' | 'D1' | 'D2' | 'D3';
export type EnemyKey = 'drone' | 'raider' | 'dreadnought' | 'boss';
/** Toda nave ou inimigo precisa de um modelo 3D e pontos de tiro com esta chave em models.ts. */
export type ModelKey = ShipKey | EnemyKey | 'station';

export interface ShipDef {
  name: string;
  /** limite de módulos por tipo */
  slots: Record<ModType, number>;
  r: number; hp: number; speed: number; cost: number;
  /** porão: quanto minério a nave carrega */
  cargo: number;
}
export interface ModDef {
  name: string; type: ModType; val: number; cost: number;
  /** arquivo do modelo 3D: public/models/<MODEL_DIR do tipo>/<model>.glb. Só vira o ícone no hangar (sem o arquivo,
   *  aparece o desenho do tipo); o equipamento não é mostrado na nave. */
  model?: string;
  /** escudo: cor da aura em volta da nave; motor: cor da chama. Sempre '#rrggbb', combinando com o modelo. */
  color?: string;
}
export interface EnemyDef {
  key: EnemyKey; name: string;
  hp: number; sh: number; dmg: number; speed: number; reward: number;
  r: number; color: string;
  /** ataca ao ver o jogador (senão só reage se for atacado) */
  aggro: boolean;
  /** alienígena sem motor: não solta chama */
  organic?: boolean;
  /** distância de tiro (padrão 500) */
  range?: number;
}

// ---------- economia ----------
// Ideia da progressão: sempre há algo que dá para comprar em poucos minutos. Cada item custa de 2 a 7 minutos da renda
// de quem está naquele estágio, e cada degrau de inimigo paga cerca de 2x o anterior. Mk1 é da era do Scout, Mk2 da
// Corvette, Mk3 do Cruiser. Ao mexer nos números, confira a espera entre compras (o teste mede a maior delas).
export const START = {credits: 300, ship: 'scout', mods: ['L1', 'L1', 'S1']} as const; // sobra um slot de arma: a 1ª compra é imediata
export const SHIPS: Record<ShipKey, ShipDef> = {
  scout:    {name: 'Scout',    slots: {laser: 3,  shield: 1, engine: 1, aim: 1, missile: 1, mining: 1}, r: 18, hp: 1200,  speed: 260, cost: 0, cargo: 60},
  corvette: {name: 'Corvette', slots: {laser: 6,  shield: 2, engine: 2, aim: 1, missile: 1, mining: 1}, r: 22, hp: 4000,  speed: 240, cost: 9000, cargo: 150},
  cruiser:  {name: 'Cruiser',  slots: {laser: 10, shield: 3, engine: 3, aim: 1, missile: 2, mining: 1}, r: 28, hp: 11000, speed: 210, cost: 30000, cargo: 400},
  // tier 4: os mesmos slots e a mesma vida do Cruiser, bem mais rápida
  interceptor: {name: 'Interceptor', slots: {laser: 10, shield: 3, engine: 3, aim: 1, missile: 2, mining: 1}, r: 26, hp: 11000, speed: 300, cost: 60000, cargo: 250},
};
export const MODS: Record<ModKey, ModDef> = {
  L1: {name: 'Laser Mk1',  type: 'laser',  val: 25,   cost: 300,  model: 'mp1'},
  L2: {name: 'Laser Mk2',  type: 'laser',  val: 55,   cost: 1500, model: 'mp2'},
  L3: {name: 'Laser Mk3',  type: 'laser',  val: 120,  cost: 7000, model: 'mk3'},
  S1: {name: 'Escudo Mk1', type: 'shield', val: 300,  cost: 300,  model: 'shield1', color: '#35c8f5'},
  S2: {name: 'Escudo Mk2', type: 'shield', val: 750,  cost: 1500, model: 'shield2', color: '#35c8f5'},
  S3: {name: 'Escudo Mk3', type: 'shield', val: 1800, cost: 7000, model: 'shield3', color: '#35c8f5'},
  E1: {name: 'Motor Mk1',  type: 'engine', val: 40,   cost: 400,  model: 'engine2', color: '#f0902a'},
  E2: {name: 'Motor Mk2',  type: 'engine', val: 90,   cost: 2000, model: 'engine1', color: '#35c8f5'},
  // mira: val = pontos percentuais somados a ACCURACY. Um slot por nave; a Mk3 completa os 100%: acerta sempre.
  A1: {name: 'Mira Mk1',   type: 'aim',    val: 7,    cost: 400,  model: 'mira1'},
  A2: {name: 'Mira Mk2',   type: 'aim',    val: 13,   cost: 2000, model: 'mira2'},
  A3: {name: 'Mira Mk3',   type: 'aim',    val: 25,   cost: 7000, model: 'mira3'},
  // míssil: val = dano de cada míssil. Lançado à mão pela barra de atalhos (tecla 2), um por módulo equipado, a cada
  // MISSILE_CD segundos. O teste de economia conta esse dano supondo que o jogador lança sempre que recarrega.
  M1: {name: 'Míssil Mk1', type: 'missile', val: 200,  cost: 600,   model: 'missil1'},
  M2: {name: 'Míssil Mk2', type: 'missile', val: 500,  cost: 3000,  model: 'missil2'},
  M3: {name: 'Míssil Mk3', type: 'missile', val: 1100, cost: 10000, model: 'missil3'},
  M4: {name: 'Míssil Mk4', type: 'missile', val: 2400, cost: 25000, model: 'missil4'},
  // minerador: val = minério extraído por segundo pelo feixe. Sem um equipado, a nave não minera.
  D1: {name: 'Minerador Mk1', type: 'mining', val: 1, cost: 500},
  D2: {name: 'Minerador Mk2', type: 'mining', val: 2, cost: 2500},
  D3: {name: 'Minerador Mk3', type: 'mining', val: 4, cost: 8000},
};
/** pasta de cada tipo de módulo dentro de public/models/ */
export const MODEL_DIR: Record<ModType, string> = {laser: 'weapons', shield: 'shields', engine: 'engines', aim: 'aim', missile: 'missiles', mining: 'mining'};
/** o que o valor do módulo soma; vem colado ao número: "+25 de dano", "+7% de precisão" */
export const LABEL: Record<ModType, string> = {laser: ' de dano', shield: ' de escudo', engine: ' de velocidade', aim: '% de precisão', missile: ' de dano por míssil', mining: ' de minério por segundo'};
/** nome do tipo de slot, no plural e no singular ("3 armas", "1 arma") */
export const SLOT: Record<ModType, string> = {laser: 'armas', shield: 'escudos', engine: 'motores', aim: 'miras', missile: 'mísseis', mining: 'mineradores'};
export const SLOT_ONE: Record<ModType, string> = {laser: 'arma', shield: 'escudo', engine: 'motor', aim: 'mira', missile: 'míssil', mining: 'minerador'};

// Do mais fraco ao mais forte; quanto mais longe da base, mais alto na lista o inimigo que nasce.
// key = modelo 3D (as variantes Alfa, Elite e Prime usam o mesmo modelo, maior). A recompensa cresce menos que a
// vida: inimigo forte paga mais no total, mas um pouco menos por ponto de vida.
export const ENEMIES: EnemyDef[] = [
  {key: 'drone',       name: 'Drone',             hp: 300,   sh: 150,   dmg: 12,  speed: 170, reward: 120,  r: 14, color: '#ff8844', aggro: false, organic: true},
  {key: 'drone',       name: 'Drone Alfa',        hp: 700,   sh: 350,   dmg: 22,  speed: 180, reward: 260,  r: 19, color: '#ffbb44', aggro: false, organic: true},
  {key: 'raider',      name: 'Raider',            hp: 1500,  sh: 900,   dmg: 45,  speed: 200, reward: 550,  r: 20, color: '#ff4444', aggro: true},
  {key: 'raider',      name: 'Raider Elite',      hp: 3200,  sh: 2000,  dmg: 85,  speed: 210, reward: 1100, r: 25, color: '#ff44aa', aggro: true},
  {key: 'dreadnought', name: 'Dreadnought',       hp: 7500,  sh: 5000,  dmg: 160, speed: 120, reward: 2400, r: 34, color: '#cc44ff', aggro: true},
  {key: 'dreadnought', name: 'Dreadnought Prime', hp: 16000, sh: 11000, dmg: 450, speed: 110, reward: 4800, r: 44, color: '#8844ff', aggro: true},
];
// Chefe: um só no mapa dele, rondando um ponto fixo; volta depois de destruído (posição e tempo ficam no mapa, em MAPS).
// Fica fora de ENEMIES: não nasce por sorteio nem entra na conta de renda do teste de economia. É o objetivo de fim de
// jogo: enorme, lento e com muita vida. Alcança mais longe que os lasers do jogador (RANGE), então não dá para
// vencê-lo só mantendo distância; um Cruiser completo precisa de várias investidas, recuando para recuperar o escudo.
export const BOSS: EnemyDef = {key: 'boss', name: 'Leviatã', hp: 200000, sh: 30000, dmg: 500, speed: 45, reward: 40000, r: 120, color: '#7dff6a', aggro: true, organic: true, range: 700};

// ---------- mineração ----------
// Asteroides espalhados pelo mapa guardam minério. Clicar num deles, com um minerador equipado e a nave a até
// MINE_RANGE, liga o feixe: o minério passa aos poucos para o porão, até o asteroide se esgotar ou o porão encher.
// A carga é vendida no hangar. Preços e ritmo foram postos para minerar render um pouco menos que caçar na mesma
// fase do jogo (é a atividade sem risco): Mk1 em Ametista ~240 cr/min, Mk2 em Turquesa ~1.200, Mk3 em Safira ~5.300,
// sem contar viagem nem as idas à base para vender.
export type OreKey = 'purple' | 'cyan' | 'blue';
export interface OreDef {
  name: string;
  /** créditos por unidade vendida */
  price: number;
  /** cor do feixe, do minimapa e dos textos */
  color: string;
  /** modelo do asteroide: public/models/asteroids/<model>.glb */
  model: string;
}
export const ORES: Record<OreKey, OreDef> = {
  purple: {name: 'Ametista', price: 4,  color: '#b56cff', model: 'asteroide2'},
  cyan:   {name: 'Turquesa', price: 10, color: '#4fe3e3', model: 'asteroide3'},
  blue:   {name: 'Safira',   price: 22, color: '#5a8dff', model: 'asteroide4'},
};
/** alcance do feixe de mineração, e quanto minério um asteroide guarda (sorteado entre os dois valores) */
export const MINE_RANGE = 260, ROCK_ORE = [40, 90] as const;
/** no inventário, o minério se empilha em packs deste tamanho (uma casa por pack) */
export const ORE_STACK = 50;

// ---------- mapas ----------
// Para criar um mapa: some a chave em MapKey, descreva-o em MAPS e ligue-o a outro com um portal de cada lado.
// Só o mapa em que o jogador está existe na simulação: ao sair, ele é descartado, e ao voltar é repovoado do zero.
export type MapKey = 'outer';
export interface MapDef {
  name: string;
  w: number; h: number;
  /** imagem de fundo, em public/bg/ */
  bg: string;
  /** base aliada: zona segura (raio r), estação e hangar. Mapa sem base não tem zona segura nem hangar. */
  base?: { x: number; y: number; r: number };
  /** onde a nave aparece ao começar o jogo ou renascer aqui (só usado no mapa HOME) */
  spawn: { x: number; y: number };
  /** inimigos comuns vivos no mapa (o chefe é contado à parte) */
  population: number;
  /** do mais fraco ao mais forte: quanto mais longe da base (ou do spawn, se não há base), mais alto na lista */
  enemies: EnemyDef[];
  /** asteroides no mapa, e os minérios deles: do mais comum (perto da base) ao mais valioso (longe) */
  asteroids: number;
  ores: OreKey[];
  /** chefe do mapa: ronda (x, y) e volta respawn segundos depois de destruído */
  boss?: { def: EnemyDef; x: number; y: number; respawn: number };
  /** portais: em (x, y) deste mapa; levam ao ponto (tx, ty) do mapa to, que deve ficar longe dos portais de lá */
  portals: { x: number; y: number; to: MapKey; tx: number; ty: number }[];
}
/** mapa onde o jogo começa e para onde a nave volta ao ser destruída; precisa ter base */
export const HOME: MapKey = 'outer';
export const MAPS: Record<MapKey, MapDef> = {
  outer: {
    name: 'Outer Space', w: 9000, h: 6000, bg: 'mapa-1.png',
    base: {x: 600, y: 600, r: 450},
    spawn: {x: 600, y: 910}, // em frente à estação, não dentro dela
    population: 40, enemies: ENEMIES,
    asteroids: 30, ores: ['purple', 'cyan', 'blue'],
    boss: {def: BOSS, x: 7800, y: 5100, respawn: 300}, // no canto oposto à base
    portals: [],
  },
};
