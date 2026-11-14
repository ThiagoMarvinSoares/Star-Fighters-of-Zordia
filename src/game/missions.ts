// Missões: cada uma é um bloco de dados em MISSIONS, e o motor abaixo faz o resto (contar o objetivo, saber quando há
// conversa na base, entregar presentes e recompensas, passar para a próxima). Para criar uma missão, acrescente um bloco
// e aponte o next da anterior para ela. Para um personagem novo, acrescente o nome em NAMES e o retrato em ui/missions.ts.
//
// Fluxo de uma missão: 'offer' (o "!" na base; a conversa de início) -> 'active' (objetivo no painel; a simulação avisa
// eventos com progress) -> 'ready' (objetivo cumprido; o "!" volta) -> conversa de entrega, que já emenda a conversa de
// início da próxima, se houver. A missão atual fica em save.quest.
import type { EnemyKey, ModKey, ModType, OreKey } from './data.ts';
import { MODS } from './data.ts';
import { save, giveMod, onBought } from './state.ts';
import type { QuestStage } from './state.ts';

/** quem fala nas conversas (os retratos ficam em ui/missions.ts) */
export type Who = 'huedro' | 'fabricio';
export const NAMES: Record<Who, string> = {huedro: 'Comandante Augusto', fabricio: 'Fabrício'};
/** uma fala: só o texto (quem fala é quem passa a missão) ou [quem, texto] */
export type Line = string | [Who, string];
/** objetivo: destruir inimigos de um tipo (key do modelo: 'drone' vale para Drone e Drone Alfa), extrair um minério
 *  ou comprar módulos de um tipo */
export type Goal = { kill: EnemyKey; count: number } | { mine: OreKey; count: number } | { buy: ModType; count: number };
export interface Mission {
  id: string;
  /** quem passa a missão: fala as linhas sem dono e assina o objetivo no painel */
  giver: Who;
  /** conversa de início */
  start: Line[];
  /** abrir o hangar quando a conversa de início termina */
  shop?: boolean;
  /** itens dados ao começar (para a missão ser possível); não dá um item de um tipo que o piloto já tenha */
  gift?: ModKey[];
  goal: Goal;
  /** o objetivo no painel (a contagem é acrescentada sozinha) e a dica de controle, embaixo */
  text: string; hint: string;
  /** conversa de entrega */
  end: Line[];
  /** minério que o piloto entrega ao terminar (até o que tiver no porão) */
  take?: Partial<Record<OreKey, number>>;
  reward?: { credits?: number; items?: ModKey[] };
  /** a missão seguinte; sem ela, a sequência acaba */
  next?: string;
}

export const MISSIONS: Mission[] = [
  {
    id: 'boas-vindas', giver: 'huedro', next: 'primeiro-laser',
    start: [
      'Ora, ora... mais um piloto novo! Gente nova aparece na minha base toda semana. Já nem me assusto mais. No começo, eu achava que era invasão.',
      'Eu sou Pedro Augusto. Para você, Comandante Augusto. Os mais próximos me chamam de Huedro... mas acho que ainda não temos essa intimidade, não é?',
      'Esta estação é a nossa base. Enquanto você estiver na área dela, estará seguro: os inimigos não chegam perto, e é só aqui que a equipe conserta o casco da sua nave.',
      'Vamos ao primeiro serviço. Aqui por perto rondam alguns Drones, criaturas orgânicas que só atacam quem mexe com elas. Trave a mira em um, abra fogo e veja como eles se desfazem.',
      'Derrube três e volte aqui para conversarmos. E não vá longe demais: lá no fundo do setor a coisa fica feia.',
    ],
    goal: {kill: 'drone', count: 3}, text: 'Destrua 3 Drones', hint: 'Clique num Drone para mirar · 1 ou Espaço liga os canhões',
    end: [
      'Olha só, voltou inteiro! Estou começando a gostar de você.',
      'Cada inimigo derrubado rende créditos, e é aqui no hangar da estação que eles viram equipamento.',
    ],
  },
  {
    id: 'primeiro-laser', giver: 'huedro', next: 'amostras', shop: true,
    start: ['Sua nave ainda tem espaço para mais um laser. Compre um e sinta a diferença.'],
    goal: {buy: 'laser', count: 1}, text: 'Compre um laser no hangar', hint: 'Clique na estação ou aperte B',
    end: [
      'Agora sim, isso é uma nave de verdade! Daqui em diante, quem passa as suas missões é o Fabrício, nosso supervisor de operações. E é ele que vai lhe ensinar a minerar.',
      'Só um aviso: o Fabrício questiona tudo. Até as minhas ordens. Não leve para o lado pessoal.',
    ],
  },
  {
    id: 'amostras', giver: 'fabricio', gift: ['D1'],
    start: [
      'Eu questiono o que não vem acompanhado de dados, Comandante. As suas ordens raramente vêm.',
      'Sou o Fabrício, supervisor de operações desta base. Estou analisando a composição dos asteroides do setor e preciso de amostras. Leituras a distância não me bastam: quero o minério na bancada.',
      'Começamos pela Ametista, a mais comum. Turquesa e Safira são mais duras e valem mais, mas exigem mineradores melhores e ficam em áreas mais perigosas. Uma coisa de cada vez.',
      'Mandei instalar um Minerador Mk1 na sua nave. Não é presente: é equipamento de trabalho. Encoste num asteroide roxo e ele faz a extração sozinho.',
      'Traga vinte unidades de Ametista para análise. Nem dezenove, nem estimativa. Vinte.',
    ],
    goal: {mine: 'purple', count: 20}, text: 'Extraia 20 de Ametista para análise', hint: 'Clique num asteroide roxo para minerar',
    end: [
      'Vinte unidades. Deixe-me ver...',
      'Pureza dentro do esperado, nenhum traço de contaminação orgânica. Os Drones ainda não chegaram a esses asteroides. Isso é um dado, e dados me deixam de bom humor.',
      'As amostras ficam comigo. Pelo serviço, 300 créditos. Não é generosidade: é o preço justo pelo transporte.',
      'O resto do que você extrair, venda no hangar. A partir de agora, as missões passam por mim. Traga resultados e vamos nos entender bem.',
    ],
    take: {purple: 20}, reward: {credits: 300},
  },
];
const byId = new Map(MISSIONS.map(m => [m.id, m]));
export const mission = (id: string) => byId.get(id);

// ---------- motor ----------
// Progresso salvo antes das missões (o tutorial numerado, save.tut): convertido uma vez para o ponto equivalente.
const LEGACY: Record<number, [string, QuestStage]> = {0: ['boas-vindas', 'offer'], 1: ['boas-vindas', 'active'], 2: ['boas-vindas', 'ready'],
  3: ['primeiro-laser', 'active'], 4: ['primeiro-laser', 'ready'], 5: ['', 'done'], 6: ['amostras', 'active'], 7: ['amostras', 'ready']};
/** a missão atual (sem nada salvo: a primeira, esperando a conversa) */
function quest() {
  if (!save.quest) {
    const [id, stage] = save.tut === undefined ? [MISSIONS[0].id, 'offer' as QuestStage] : LEGACY[save.tut] ?? [MISSIONS[0].id, 'offer' as QuestStage];
    save.quest = {id, stage, n: stage === 'active' ? save.tutN ?? 0 : 0};
    delete save.tut; delete save.tutN;
  }
  if (save.quest.stage !== 'done' && !byId.has(save.quest.id)) save.quest = {id: '', stage: 'done', n: 0}; // missão que deixou de existir
  return save.quest;
}
export const questNow = () => { const q = quest(); return {...q, m: byId.get(q.id)}; };
/** alguém na base tem algo a dizer: a estação ganha um "!" e clicar nela abre a conversa em vez do hangar */
export const needsTalk = () => ['offer', 'ready'].includes(quest().stage);

/** Algo aconteceu no jogo (a simulação e o hangar avisam): se for o que a missão ativa pede, conta. */
export type QuestEvent = { kill: EnemyKey } | { mine: OreKey; amount: number } | { buy: ModType };
export function progress(ev: QuestEvent) {
  const q = quest(), g = byId.get(q.id)?.goal;
  if (q.stage !== 'active' || !g) return;
  const add = 'kill' in g && 'kill' in ev && ev.kill === g.kill ? 1
            : 'mine' in g && 'mine' in ev && ev.mine === g.mine ? ev.amount
            : 'buy' in g && 'buy' in ev && ev.buy === g.buy ? 1 : 0;
  if (!add) return;
  q.n += add;
  if (q.n >= g.count - 1e-9) q.stage = 'ready';
}
onBought.push(k => progress({buy: MODS[k].type}));

/** As falas da conversa que está esperando, já com quem fala cada uma, e se o hangar abre ao fim. Na entrega, a conversa
 *  de início da próxima missão vem emendada. null = não há conversa. */
export function talkNow(): { lines: [Who, string][]; shop: boolean } | null {
  const q = quest(), m = byId.get(q.id);
  if (!m || (q.stage !== 'offer' && q.stage !== 'ready')) return null;
  const own = (ms: Mission, ls: Line[]) => ls.map((l): [Who, string] => typeof l === 'string' ? [ms.giver, l] : l);
  if (q.stage === 'offer') return {lines: own(m, m.start), shop: !!m.shop};
  const next = m.next ? byId.get(m.next) : undefined;
  return {lines: [...own(m, m.end), ...(next ? own(next, next.start) : [])], shop: !!next?.shop};
}
/** Fim da conversa: aplica o que ela combinou e avança. Devolve o que o piloto recebeu, para a tela avisar. */
export function talkDone(): { items: ModKey[]; credits: number } {
  const q = quest(), m = byId.get(q.id), got = {items: [] as ModKey[], credits: 0};
  const begin = (ms: Mission) => { // a missão começa: presentes e objetivo zerado
    for (const k of ms.gift ?? []) if (![...save.mods, ...save.inv].some(o => MODS[o].type === MODS[k].type)) { giveMod(k); got.items.push(k); }
    save.quest = {id: ms.id, stage: 'active', n: 0};
  };
  if (!m) return got;
  if (q.stage === 'offer') begin(m);
  else if (q.stage === 'ready') {
    for (const [ore, n] of Object.entries(m.take ?? {}) as [OreKey, number][]) save.cargo[ore] -= Math.min(n, Math.floor(save.cargo[ore]));
    if (m.reward?.credits) { save.credits += m.reward.credits; got.credits = m.reward.credits; }
    for (const k of m.reward?.items ?? []) { giveMod(k); got.items.push(k); }
    const next = m.next ? byId.get(m.next) : undefined;
    if (next) begin(next); else save.quest = {id: '', stage: 'done', n: 0};
  }
  return got;
}
/** O objetivo para o painel: o texto com a contagem, a dica e quem passou a missão; ou o lembrete de voltar à base para
 *  conversar. null quando não há missão. */
export function questGoal(): { goal: string; hint: string; who: string } | null {
  const q = quest(), m = byId.get(q.id);
  if (!m || q.stage === 'done') return null;
  const who = NAMES[m.giver];
  if (q.stage !== 'active') return {goal: `Volte à base e fale com ${who}`, hint: 'Clique na estação', who}; // conversa esperando
  const g = m.goal, n = Math.floor(q.n);
  return {goal: g.count > 1 ? `${m.text} (${n}/${g.count})` : m.text, hint: m.hint, who};
}
/** recomeça a sequência do início (botão de tutorial) */
export const restart = () => { save.quest = {id: MISSIONS[0].id, stage: 'offer', n: 0}; };
/** pula a sequência inteira */
export const skipAll = () => { save.quest = {id: '', stage: 'done', n: 0}; };
