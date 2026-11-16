// Missões: cada uma é um bloco de dados em MISSIONS, e o motor abaixo faz o resto (contar o objetivo, saber quando há
// conversa, entregar presentes e recompensas, passar para a próxima). Para criar uma missão, acrescente um bloco e aponte
// o next da anterior para ela. Para um personagem novo, acrescente o nome em NAMES e o retrato em ui/missions.ts.
// Guia completo: docs/MISSOES.md.
//
// Fluxo de uma missão: 'offer' (o "!" na base; a conversa de início) -> 'active' (objetivo no painel; a simulação avisa
// eventos com progress e arrive) -> 'ready' (objetivo cumprido) -> conversa de entrega, que já emenda a conversa de início
// da próxima, se houver. A entrega é na base (o "!" volta) ou, com report: 'field', ali mesmo, na hora.
//
// Há duas sequências independentes: a principal (save.quest, começa pelo tutorial) e a secundária (save.side), que é
// oferecida na base quando a principal termina.
import type { EnemyKey, MapKey, ModKey, ModType, OreKey } from './data.ts';
import { MAPS, HOME } from './data.ts';
import { MODS } from './data.ts';
import { save, giveMod, onBought } from './state.ts';
import type { QuestStage } from './state.ts';

/** Quem fala nas conversas (os retratos ficam em ui/missions.ts). Elyra, Heathcliff e os sistemas não têm rosto: falam
 *  por transmissão, gravação ou terminal. */
export type Who = 'huedro' | 'fabricio' | 'elyra' | 'elyra-log' | 'heathcliff' | 'bordo' | 'sistema';
export const NAMES: Record<Who, string> = {huedro: 'Comandante Augusto', fabricio: 'Fabrício', elyra: 'Elyra', 'elyra-log': 'Elyra',
                                           heathcliff: 'Heathcliff', bordo: 'Computador de bordo', sistema: 'Sistema da estação'};
/** Uma fala: só o texto (quem fala é quem passa a missão), [quem, texto] ou [quem, texto, segundos]. Os segundos seguram a
 *  fala na tela antes de liberar o "Próximo": é como se faz um silêncio (com texto vazio). */
export type Line = string | [Who, string] | [Who, string, number];
/** Lugares para objetivos de "ir até lá" (goal.reach): o mapa, o centro e o raio de chegada. */
export const PLACES: Record<string, { map: MapKey; x: number; y: number; r: number }> = {
  'nave-elyra': {map: 'outer', x: 8300, y: 5400, r: 220}, // no canto mais afastado da base; os Raiders Elite que a guardam ficam em MAPS.outer.guards
  'estacao-abandonada': {map: 'silent', x: 7200, y: 1950, r: 330},
  'sistema-central': {map: 'silent', x: 7200, y: 2180, r: 90},
  'base': {map: HOME, ...MAPS[HOME].base!}, // a base aliada, em Outer Space // a doca da estação abandonada, logo abaixo dela
};
export type PlaceId = string;
/** As coordenadas de um lugar, como aparecem no minimapa: "Rotas Silenciosas · X 7200 · Y 1950" */
export const coords = (id: PlaceId) => { const q = PLACES[id]; return `${MAPS[q.map].name} · X ${q.x} · Y ${q.y}`; };
/** objetivo: destruir inimigos de um tipo (key do modelo: 'drone' vale para Drone e Drone Alfa), extrair um minério,
 *  comprar módulos de um tipo, ou chegar a um lugar (conta ao entrar no raio dele) */
export type Goal = { kill: EnemyKey; count: number } | { mine: OreKey; count: number } | { buy: ModType; count: number } | { reach: PlaceId };
export interface Mission {
  id: string;
  /** nome da missão no menu de missões */
  title: string;
  /** quem passa a missão: fala as linhas sem dono e assina o objetivo no painel */
  giver: Who;
  /** conversa de início; vazia, a missão começa sozinha, já em andamento (sem "!" na base) */
  start: Line[];
  /** Objetivo secreto: enquanto não for cumprido, não aparece no painel, no marcador do mapa nem no menu de missões. É
   *  como uma história começa por descoberta (achar a nave de Elyra), sem ninguém mandar o piloto lá. */
  hidden?: boolean;
  /** Lugar que o piloto ainda não viu: sem marcador (anel, losango e seta). Ele acha pelas coordenadas que os personagens
   *  passam na conversa, comparando com as da nave, acima do minimapa. Voltar à base e voltar a lugares já achados têm
   *  marcador. */
  find?: boolean;
  /** abrir o hangar quando a conversa de início termina */
  shop?: boolean;
  /** itens dados ao começar (para a missão ser possível); não dá um item de um tipo que o piloto já tenha */
  gift?: ModKey[];
  goal: Goal;
  /** o objetivo no painel (a contagem é acrescentada sozinha) e a dica de controle, embaixo */
  text: string; hint: string;
  /** conversa de entrega */
  end: Line[];
  /** 'field': a conversa de entrega abre ali mesmo, assim que o objetivo é cumprido (padrão: na base, pelo "!") */
  report?: 'field';
  /** Uma escolha no fim da conversa de entrega: dois botões. Com yes, tocam as falas then e a missão termina. Com no:
   *  havendo otherwise, tocam essas falas e a missão termina do mesmo jeito (a escolha muda o caminho, não o fim); sem
   *  otherwise, a conversa fecha e a missão volta a 'active' (num objetivo de lugar, é preciso sair e voltar). */
  ask?: { yes: string; no: string; then: Line[]; otherwise?: Line[] };
  /** A fala de end (pelo índice) em que o cenário da missão começa a se mexer: hoje, a nave de Elyra vindo sozinha até a
   *  estação (ver scenery). */
  cue?: number;
  /** transmissões soltas que chegam de vez em quando enquanto o objetivo está ativo (legendas no topo da tela) */
  radio?: Line[];
  /** minério que o piloto entrega ao terminar (até o que tiver no porão) */
  take?: Partial<Record<OreKey, number>>;
  reward?: { credits?: number; items?: ModKey[] };
  /** a missão seguinte; sem ela, a sequência acaba */
  next?: string;
}

export const MISSIONS: Mission[] = [
  {
    id: 'boas-vindas', title: 'Boas-vindas', giver: 'huedro', next: 'primeiro-laser',
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
    id: 'primeiro-laser', title: 'O primeiro laser', giver: 'huedro', next: 'amostras', shop: true,
    start: ['Sua nave ainda tem espaço para mais um laser. Compre um e sinta a diferença.'],
    goal: {buy: 'laser', count: 1}, text: 'Compre um laser no hangar', hint: 'Clique na estação ou aperte B',
    end: [
      'Agora sim, isso é uma nave de verdade! Daqui em diante, quem passa as suas missões é o Fabrício, nosso supervisor de operações. E é ele que vai lhe ensinar a minerar.',
      'Só um aviso: o Fabrício questiona tudo. Até as minhas ordens. Não leve para o lado pessoal.',
    ],
  },
  {
    id: 'amostras', title: 'Amostras para análise', giver: 'fabricio', gift: ['D1'],
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

  // ---------- secundária: Wuthering Heights ----------
  // Elyra, exploradora, morreu à deriva quando a nave despressurizou; Heathcliff morreu esperando por ela na estação.
  // Nenhum dos dois aparece: só registros, transmissões, sensores e a porta. O fim não explica nada.
  {
    // Começa por descoberta: a missão já nasce em andamento e escondida (hidden); a conversa abre quando o piloto chega
    // perto da nave à deriva, no canto mais afastado de Outer Space.
    id: 'o-sinal-perdido', title: 'O sinal perdido', giver: 'fabricio', next: 'a-estacao', report: 'field', hidden: true,
    start: [],
    goal: {reach: 'nave-elyra'}, text: 'Investigue a nave à deriva', hint: 'No canto mais afastado do setor',
    end: [
      'Piloto, um momento. Os seus sensores acabaram de captar um transponder humano. Bem aí, na sua frente. Modelo antigo. Muito antigo.',
      'Cruzei o código com os arquivos da Aliança: é a nave de Elyra, uma exploradora dada como desaparecida há muitos anos. O caso foi encerrado sem conclusão. Eu não gosto de casos sem conclusão.',
      ['huedro', 'Elyra... eu me lembro desse nome. Eu ainda era cadete quando cancelaram as buscas.'],
      ['huedro', 'Piloto, acople e recupere os registros. Quero saber o que aconteceu com ela. E tome cuidado: sinal velho às vezes traz coisa que é melhor deixar onde está.'],
      'Sinais não trazem nada, Comandante. Eles só transmitem.',
      'Acoplamento confirmado. Estou recebendo os dados da nave pelo seu link. Vá devagar.',
      ['bordo', 'COMPARTIMENTOS 1 A 4: DESPRESSURIZADOS. SUPORTE À VIDA: DESLIGADO.'],
      ['bordo', 'REGISTRO DE EMERGÊNCIA 117: INTERROMPIDO.'],
      ['elyra-log', 'Estação, aqui é Elyra. Perdi a pressão no casco de popa. Estou isolando os compartimentos. Respondam.'],
      ['elyra-log', 'Estação, respondam. Heathcliff, se estiver ouvindo, acenda o farol. Eu encontro a casa pela luz.'],
      ['elyra-log', 'Tentativa de contato número quarenta e dois. Ninguém responde. Mas eu sei que você está aí.'],
      ['elyra-log', 'Heathcliff... eu estou voltando. Não importa quanto tempo leve. Espere por mim.'],
      ['elyra-log', '', 2.5],
      'O registro termina aí. O oxigênio acabou poucas horas depois. Ela não sobreviveu.',
      '...Isso não faz sentido. O transmissor da nave continua ativo. Sem energia, sem tripulação, e ainda assim transmitindo.',
    ],
  },
  {
    id: 'a-estacao', title: 'A estação', giver: 'fabricio', next: 'o-ultimo-retorno', report: 'field', cue: 9, // cue: no ALERTA
    start: [
      'Os registros de navegação dela apontam todos para o mesmo lugar: uma estação orbital antiga, desativada, do outro lado do portal sul. Era para lá que ela voltava.',
      `Encontrei as coordenadas. Rotas Silenciosas, X ${PLACES['estacao-abandonada'].x}, Y ${PLACES['estacao-abandonada'].y}. Já estão no seu mapa. Siga até lá. Eu quero entender isso.`,
    ],
    goal: {reach: 'estacao-abandonada'}, text: 'Vá até a estação abandonada', hint: coords('estacao-abandonada'),
    radio: [['elyra', '...Heath... cliff...'], ['elyra', '...estou voltando...'], ['elyra', '...não vejo a luz... onde está a luz...']],
    end: [
      'Nenhuma atividade humana detectável. Nenhum sistema de defesa. Só silêncio. Faça uma varredura dos alojamentos.',
      ['fabricio', '...', 2],
      'Alojamento 3. Os sensores encontraram alguém.',
      'É ele. Heathcliff, responsável pela manutenção da estação. Pelo estado do corpo, morreu muitos anos depois de Elyra.',
      'Os registros mostram que ele manteve a estação funcionando sozinho. Ano após ano. Ele nunca pediu evacuação.',
      ['heathcliff', 'Eu já não conto os dias. O farol continua aceso. Se ela estiver por perto, vai ver a luz.'],
      ['heathcliff', 'Os geradores estão falhando. Não vou conseguir manter a estação por muito mais tempo.'],
      ['heathcliff', 'Se ela voltar, não deixem a porta fechada.'],
      'É a última gravação. Depois dela, nada.',
      ['sistema', 'ALERTA: TENTATIVA DE ACESSO NA ENTRADA PRINCIPAL.'],
      'Isso é impossível. Não há ninguém aqui além de você.',
      ['elyra', 'Heathcliff... estou aqui. Abra a porta.', 2],
      ['huedro', 'Piloto, que transmissão foi essa? Fabrício, me diga que é uma falha.'],
      'As câmeras externas... Comandante, a nave de Elyra está ao lado da estação. Ela estava à deriva do outro lado do portal, no fundo do setor. Aquela nave não tem motores.',
      ['sistema', 'ENTRADA PRINCIPAL: NOVA TENTATIVA DE ACESSO. NENHUMA PRESENÇA FÍSICA DETECTADA.'],
    ],
  },
  {
    // cue: a nave some no silêncio logo depois da escolha (a 2ª fala de then e de otherwise, nas duas respostas)
    id: 'o-ultimo-retorno', title: 'O último retorno', giver: 'fabricio', next: 'depois-do-silencio', report: 'field', cue: 5,
    start: [
      ['huedro', 'Eu não sei o que está batendo naquela porta, Fabrício. E acho que você também não sabe.'],
      'Não sei. Ainda. O sistema central fica na doca principal da estação. Piloto, vá até lá. Quero acesso direto aos registros.',
    ],
    goal: {reach: 'sistema-central'}, text: 'Acesse o sistema central da estação', hint: coords('sistema-central'),
    radio: [['elyra', 'Heathcliff... abra a porta.'], ['elyra', '...está frio aqui fora...']],
    end: [
      ['sistema', 'SISTEMA CENTRAL. ÚLTIMA GRAVAÇÃO DO RESPONSÁVEL:'],
      ['heathcliff', 'Se ela voltar, não deixem a porta fechada.'],
      ['elyra', 'Heathcliff... por favor. Está frio aqui fora.', 2],
      ['sistema', 'ENTRADA PRINCIPAL: BLOQUEADA. LIBERAR MANUALMENTE?'],
    ],
    ask: {yes: 'Liberar a entrada', no: 'Manter fechada', then: [
      ['sistema', 'LIBERANDO TRAVAS.'],
      ['sistema', '', 4],
      ['sistema', 'ACESSO CONCEDIDO.', 2],
      ['fabricio', '', 3],
      'A transmissão parou.',
      'Não enfraqueceu, não foi sumindo. Parou, no mesmo segundo em que as travas abriram.',
      'E a nave dela não está mais nos sensores. Nenhum destroço, nenhum rastro de motor. Onde ela estava, não há nada.',
      ['huedro', 'Fabrício.'],
      'Eu sei, Comandante. Eu também vi.',
    ], otherwise: [
      ['elyra', 'Heathcliff... a porta não abre... está ficando escuro aqui fora...', 4],
      ['elyra', '', 4],
      'A transmissão foi enfraquecendo até sumir. Ninguém desligou nada: ela simplesmente se apagou.',
      'E a nave dela não está mais nos sensores. Nenhum destroço, nenhum rastro de motor. Onde ela estava, não há nada.',
      ['huedro', 'Fabrício.'],
      'Eu sei, Comandante. Eu também vi.',
    ]},
    reward: {credits: 5000},
  },
  {
    id: 'depois-do-silencio', title: 'Depois do silêncio', giver: 'huedro', next: 'o-farol', report: 'field',
    start: ['Piloto, volte para a base. Não mexa em mais nada aí. Quero vocês dois na minha sala.'],
    goal: {reach: 'base'}, text: 'Volte à base', hint: coords('base'),
    end: [
      'Sente-se, piloto. Fabrício, do começo. Devagar.',
      ['fabricio', 'Fatos. Uma nave sem motores atravessou o setor sozinha. Um transmissor sem energia transmitiu por anos. E alguém pediu para entrar numa estação vazia.'],
      ['fabricio', 'Revisei os registros três vezes. Os sensores da estação estavam calibrados, os da nave do piloto também. Não houve falha de equipamento.'],
      'Então o que foi aquilo?',
      ['fabricio', 'Eu não sei. E detesto dizer essa frase.'],
      'Quando eu era cadete, contavam que a Elyra mandava uma mensagem para a estação toda noite, mesmo sem nada para relatar. Diziam que era só para ele ouvir a voz dela.',
      ['fabricio', 'Isso é folclore de alojamento, Comandante.'],
      'Pode ser. Mas ele esperou anos com a luz acesa, e ela passou anos tentando voltar. Você tem uma explicação melhor?',
      ['fabricio', '', 2],
      ['fabricio', 'Tenho uma hipótese. Um eco: uma gravação presa no sistema da estação, disparada quando o piloto se aproximou.'],
      'E a nave que se moveu sozinha?',
      ['fabricio', 'Para isso, ainda não tenho hipótese.'],
      ['fabricio', 'E há mais uma coisa que não fecha. Heathcliff diz que o farol estava aceso. Elyra diz que não via luz nenhuma. Os dois registros são da mesma época.'],
      'Um dos dois se enganou?',
      ['fabricio', 'Ou os dois disseram a verdade.'],
      'Então eles estavam ali, um perto do outro, procurando... e nenhum dos dois conseguia ver.',
      'E a porta, Fabrício? Faz diferença se ela estava aberta ou fechada?',
      ['fabricio', 'Para alguém que nenhum sensor detecta? Não sei, Comandante. Não sei nem se ela chegou a entrar.'],
    ],
  },
  {
    id: 'o-farol', title: 'O farol', giver: 'fabricio', report: 'field',
    start: [
      'Há uma coisa que eu ainda quero conferir: o farol da estação. Heathcliff dizia que o mantinha aceso. Os registros dizem que os geradores falharam pouco depois da última gravação dele.',
      'Se o farol estiver apagado, pelo menos o último dado bate com a física. Piloto, volte à estação e faça uma leitura. Uma última.',
      ['huedro', 'Vá, piloto. E Fabrício... e se ele estiver aceso?'],
      'Então eu vou ter uma conclusão que não sei escrever.',
    ],
    goal: {reach: 'estacao-abandonada'}, text: 'Faça uma leitura do farol da estação', hint: coords('estacao-abandonada'),
    end: [
      'Leitura iniciada. Geradores frios. Nenhuma corrente em lugar nenhum da estação.',
      ['sistema', 'FAROL: ATIVO.', 3],
      'Repita a leitura.',
      ['sistema', 'FAROL: ATIVO.', 2],
      'Não há energia para isso. Não há como.',
      ['huedro', 'Ele disse que ia deixar a luz acesa.'],
      ['huedro', 'Talvez agora ela consiga ver.'],
      ['fabricio', '', 3],
      'Vou arquivar o caso de Elyra, Comandante.',
      ['huedro', 'E o que você vai escrever?'],
      '"Nave localizada. A tripulante retornou à estação." Mais nada.',
      ['huedro', 'Você acredita nisso?'],
      'Eu acredito nos dados. E, pela primeira vez, acho que eles não precisam explicar tudo.',
      ['huedro', 'Obrigado, piloto. Agora volte para casa você também.'],
    ],
    reward: {credits: 15000}, // o fim de Wuthering Heights: a história acontece em território de Dreadnought Prime
  },
];
const byId = new Map(MISSIONS.map(m => [m.id, m]));
export const mission = (id: string) => byId.get(id);
/** primeira missão de cada sequência, e o nome da sequência no menu de missões */
const FIRST = {main: 'boas-vindas', side: 'o-sinal-perdido'};
export const CHAINS = {main: 'Tutorial', side: 'Wuthering Heights'};

// ---------- motor ----------
export type Track = 'main' | 'side';
type Slot = { id: string; stage: QuestStage; n: number };
// Progresso salvo antes das missões (o tutorial numerado, save.tut): convertido uma vez para o ponto equivalente.
const LEGACY: Record<number, [string, QuestStage]> = {0: ['boas-vindas', 'offer'], 1: ['boas-vindas', 'active'], 2: ['boas-vindas', 'ready'],
  3: ['primeiro-laser', 'active'], 4: ['primeiro-laser', 'ready'], 5: ['', 'done'], 6: ['amostras', 'active'], 7: ['amostras', 'ready']};
const DONE: Slot = {id: '', stage: 'done', n: 0};
/** a missão atual é um objetivo secreto ainda não descoberto: não aparece em lugar nenhum, nem refeita. A nave precisa
 *  ser achada; só então alguém fala dela. */
const secret = (q: Slot | null) => !!q && q.stage === 'active' && !!byId.get(q.id)?.hidden;
/** A missão atual de uma sequência. A principal, sem nada salvo, é a primeira esperando a conversa; a secundária existe
 *  desde o começo, com a primeira missão escondida (hidden) até o piloto achar a nave de Elyra. */
function slot(track: Track): Slot | null {
  if (track === 'main') {
    if (!save.quest) {
      const [id, stage] = save.tut === undefined ? [FIRST.main, 'offer' as QuestStage] : LEGACY[save.tut] ?? [FIRST.main, 'offer' as QuestStage];
      save.quest = {id, stage, n: stage === 'active' ? save.tutN ?? 0 : 0};
      delete save.tut; delete save.tutN;
    }
    if (save.quest.stage !== 'done' && !byId.has(save.quest.id)) save.quest = {...DONE}; // missão que deixou de existir
    return save.quest;
  }
  if (!save.side) save.side = {id: FIRST.side, stage: 'offer', n: 0}; // existe desde o começo: começa quando o piloto acha a nave
  if (save.side.stage !== 'done' && !byId.has(save.side.id)) save.side = {...DONE};
  if (save.side.stage === 'offer' && !byId.get(save.side.id)!.start.length) save.side = {...save.side, stage: 'active', n: 0}; // sem conversa de início: já em andamento
  return save.side;
}
const set = (track: Track, s: Slot) => { if (track === 'main') save.quest = s; else save.side = s; };
const TRACKS: Track[] = ['main', 'side'];
/** Sequência acompanhada (escolhida no menu de missões): o objetivo dela tem a vez no painel e no marcador. Não é salva. */
export const pin: { track: Track | null } = {track: null};
/** as sequências na ordem de vez: a acompanhada primeiro */
const order = () => pin.track ? [pin.track, ...TRACKS.filter(t => t !== pin.track)] : TRACKS;
export const questNow = (track: Track = 'main') => { const q = slot(track) ?? {...DONE}; return {...q, m: byId.get(q.id)}; };
/** a conversa desta sequência é na base: a de início sempre; a de entrega, salvo report: 'field' */
const atBaseTalk = (q: Slot | null) => !!q && (q.stage === 'offer' || q.stage === 'ready' && byId.get(q.id)?.report !== 'field');
/** alguém na base tem algo a dizer: a estação ganha um "!" e clicar nela abre a conversa em vez do hangar */
export const needsTalk = () => TRACKS.some(t => atBaseTalk(slot(t)));
/** a sequência com uma conversa de campo esperando (abre sozinha, onde o piloto estiver) */
export const fieldTalk = () => TRACKS.find(t => { const q = slot(t); return q?.stage === 'ready' && byId.get(q.id)?.report === 'field'; });

/** Algo aconteceu no jogo (a simulação e o hangar avisam): se for o que uma missão ativa pede, conta. */
export type QuestEvent = { kill: EnemyKey } | { mine: OreKey; amount: number } | { buy: ModType } | { reach: PlaceId };
export function progress(ev: QuestEvent) {
  for (const t of TRACKS) {
    const q = slot(t), g = q && byId.get(q.id)?.goal;
    if (!q || q.stage !== 'active' || !g) continue;
    const add = 'kill' in g && 'kill' in ev && ev.kill === g.kill ? 1
              : 'mine' in g && 'mine' in ev && ev.mine === g.mine ? ev.amount
              : 'buy' in g && 'buy' in ev && ev.buy === g.buy ? 1
              : 'reach' in g && 'reach' in ev && ev.reach === g.reach ? 1 : 0;
    if (!add) continue;
    q.n += add;
    if (q.n >= ('count' in g ? g.count : 1) - 1e-9) q.stage = 'ready';
  }
}
onBought.push(k => progress({buy: MODS[k].type}));
// Chegada a um lugar: conta ao entrar no raio (de fora para dentro). Quem recusou a escolha de uma missão precisa sair e
// voltar para a pergunta aparecer de novo.
const inside = new Set<PlaceId>();
/** chamado pela simulação a cada quadro, com o mapa e a posição da nave */
export function arrive(map: MapKey, x: number, y: number) {
  for (const [id, pl] of Object.entries(PLACES)) {
    const now = pl.map === map && Math.hypot(x - pl.x, y - pl.y) < pl.r;
    if (now && !inside.has(id)) progress({reach: id});
    if (now) inside.add(id); else inside.delete(id);
  }
}

const own = (ms: Mission, ls: Line[]) => ls.map((l): [Who, string, number] => typeof l === 'string' ? [ms.giver, l, 0] : [l[0], l[1], l[2] ?? 0]);
/** Uma conversa: as falas (quem, texto, segundos de espera), se o hangar abre ao fim, e a escolha, se houver. */
export interface Talk { track: Track; lines: [Who, string, number][]; shop: boolean; cue?: number; ask?: { yes: string; no: string; then: [Who, string, number][]; otherwise?: [Who, string, number][] } }
function talkOf(track: Track): Talk | null {
  const q = slot(track), m = q && byId.get(q.id);
  if (!q || !m || (q.stage !== 'offer' && q.stage !== 'ready')) return null;
  if (q.stage === 'offer') return {track, lines: own(m, m.start), shop: !!m.shop};
  const next = m.next ? byId.get(m.next) : undefined;
  const after = next ? own(next, next.start) : []; // a próxima missão, emendada depois da resposta
  if (m.ask) return {track, lines: own(m, m.end), shop: false, cue: m.cue,
                     ask: {yes: m.ask.yes, no: m.ask.no, then: [...own(m, m.ask.then), ...after], ...(m.ask.otherwise && {otherwise: [...own(m, m.ask.otherwise), ...after]})}};
  return {track, lines: [...own(m, m.end), ...(next ? own(next, next.start) : [])], shop: !!next?.shop, cue: m.cue};
}
/** A conversa que está esperando na base (a principal primeiro). Na entrega, a conversa de início da próxima missão vem
 *  emendada. null = não há conversa na base. */
/** a conversa esperando numa sequência (para abrir na hora, ao refazer uma missão) */
export const talkFor = talkOf;
export const talkNow = (): Talk | null => { const t = TRACKS.find(k => atBaseTalk(slot(k))); return t ? talkOf(t) : null; };
/** a conversa de campo esperando, se houver */
export const fieldTalkNow = (): Talk | null => { const t = fieldTalk(); return t ? talkOf(t) : null; };
/** Fim de uma conversa: aplica o que ela combinou e avança. answer = a resposta da escolha (ask), quando há uma: false
 *  devolve a missão a 'active', se a escolha não tiver otherwise. Devolve o que o piloto recebeu, para a tela avisar. */
export function talkDone(track: Track = 'main', answer = true): { items: ModKey[]; credits: number } {
  const q = slot(track), m = q && byId.get(q.id), got = {items: [] as ModKey[], credits: 0};
  came = 0; // o que a conversa pôs em movimento já chegou aonde ia
  const begin = (ms: Mission) => { // a missão começa: presentes e objetivo zerado
    for (const k of ms.gift ?? []) if (![...save.mods, ...save.inv].some(o => MODS[o].type === MODS[k].type)) { giveMod(k); got.items.push(k); }
    set(track, {id: ms.id, stage: 'active', n: 0});
  };
  if (!q || !m) return got;
  if (q.stage === 'offer') begin(m);
  else if (q.stage === 'ready') {
    if (m.ask && !answer && !m.ask.otherwise) { set(track, {id: m.id, stage: 'active', n: 0}); return got; }
    if (!save.paid?.includes(m.id)) { // refeita: sem entrega de minério e sem recompensa
      for (const [ore, n] of Object.entries(m.take ?? {}) as [OreKey, number][]) save.cargo[ore] -= Math.min(n, Math.floor(save.cargo[ore]));
      if (m.reward?.credits) { save.credits += m.reward.credits; got.credits = m.reward.credits; }
      for (const k of m.reward?.items ?? []) { giveMod(k); got.items.push(k); }
    }
    const next = m.next ? byId.get(m.next) : undefined;
    if (next) begin(next); else set(track, {...DONE});
  }
  return got;
}
/** O objetivo para o painel: o texto com a contagem, a dica e quem passou a missão; ou o lembrete de voltar à base para
 *  conversar. A sequência principal tem a vez. null quando não há missão. */
export function questGoal(): { goal: string; hint: string; who: string } | null {
  for (const t of order()) {
    const q = slot(t), m = q && byId.get(q.id);
    if (!q || !m || q.stage === 'done' || secret(q)) continue;
    const who = NAMES[m.giver];
    if (q.stage !== 'active') {
      if (q.stage === 'ready' && m.report === 'field') continue; // a conversa abre sozinha
      return {goal: `Volte à base e fale com ${who}`, hint: 'Clique na estação', who};
    }
    const g = m.goal, n = Math.floor(q.n), count = 'count' in g ? g.count : 1;
    return {goal: count > 1 ? `${m.text} (${n}/${count})` : m.text, hint: m.hint, who};
  }
  return null;
}
/** os lugares para onde os objetivos ativos mandam ir, na ordem de vez (a sequência acompanhada primeiro) */
function questPlaces(marked = false): PlaceId[] {
  const out: PlaceId[] = [];
  for (const t of order()) {
    const q = slot(t), m = q?.stage === 'active' && !secret(q) ? byId.get(q.id) : undefined, g = m?.goal;
    if (g && 'reach' in g && !(marked && m!.find)) out.push(g.reach); // marked: só os que têm marcador
  }
  return out;
}
/** o lugar do objetivo ativo, para mostrar as coordenadas dele (coords) junto do minimapa */
export const questPlace = (): PlaceId | null => questPlaces()[0] ?? null;
/** O lugar para onde o objetivo ativo manda ir (marcador no minimapa e seta na tela), se houver; lugares que o piloto
 *  ainda precisa achar (Mission.find) não têm. Com map: se o lugar fica noutro mapa, o alvo é o portal deste mapa que
 *  leva até lá. */
export function questTarget(map?: MapKey): { x: number; y: number; r: number } | null {
  for (const id of questPlaces(true)) {
    const pl = PLACES[id];
    if (!map || pl.map === map) return pl;
    const door = MAPS[map].portals.find(d => d.to === pl.map);
    if (door) return {x: door.x, y: door.y, r: 70};
  }
  return null;
}
/** as transmissões soltas da missão ativa (Mission.radio), se houver */
export function questRadio() {
  for (const t of TRACKS) {
    const q = slot(t), m = q?.stage === 'active' ? byId.get(q.id) : undefined;
    if (m?.radio) return own(m, m.radio);
  }
  return null;
}

// ---------- cenário das missões ----------
// Objetos que existem no mapa por causa de uma missão: aparecem e somem conforme o progresso da sequência secundária.
// model = arquivo da biblioteca (public/models), r = raio (o modelo mede 3r), spin = voltas por minuto.
export interface Prop { id: string; map: MapKey; x: number; y: number; r: number; model: string; label: string; spin: number; a: number }
// ao lado da estação, quando ela "volta"; e de onde ela vem: entra nas Rotas Silenciosas pelo portal, sozinha
const ELYRA = {near: {x: 7480, y: 1830}, gate: MAPS.silent.portals[0]};
const PROPS = {
  elyra: {id: 'elyra', map: 'outer' as MapKey, r: 20, model: 'ships/scout', label: 'Nave de Elyra', spin: .4, a: 2.2},
  station: {id: 'station', map: 'silent' as MapKey, r: 95, model: 'bases/base_anel', label: 'Estação abandonada', spin: 0, a: .4},
};
/** quando (Date.now) a nave de Elyra começou a vir até a estação; a tela marca isso ao mostrar a fala Mission.cue */
let came = 0;
const COME = 14;
export const cue = (at = Date.now()) => { came = at; };
export function scenery(): Prop[] {
  const q = slot('side');
  if (!q) return [];
  const chain = chainOf('side').map(m => m.id), step = q.stage === 'done' ? chain.length : chain.indexOf(q.id);
  const out: Prop[] = [];
  const st = PLACES['estacao-abandonada'], ship = PLACES['nave-elyra'];
  if (step >= 1) out.push({...PROPS.station, x: st.x, y: st.y});
  // A nave de Elyra: à deriva em Outer Space até a estação ser encontrada; depois, ao lado da estação; aberta a porta,
  // some. Na conversa da estação, a partir da fala Mission.cue, ela sai da deriva e entra nas Rotas Silenciosas pelo
  // portal, sozinha, até o lado da estação: COME segundos, freando ao chegar.
  const g = ELYRA.gate, a = Math.atan2(ELYRA.near.y - g.y, ELYRA.near.x - g.x), there = {...PROPS.elyra, map: 'silent' as MapKey, a, spin: 0};
  const t = step === 1 && q.stage === 'ready' && came ? Math.min(1, (Date.now() - came) / 1000 / COME) : 0, f = 1 - (1 - t) ** 3;
  if (t > 0) out.push({...there, x: g.x + (ELYRA.near.x - g.x) * f, y: g.y + (ELYRA.near.y - g.y) * f});
  else if (step <= 1) out.push({...PROPS.elyra, x: ship.x, y: ship.y});
  else if (step === 2 && !(q.stage === 'ready' && came)) out.push({...there, ...ELYRA.near}); // some quando a porta abre
  return out;
}
/** Para o menu de missões: cada sequência já liberada, com as missões até a atual. As futuras não aparecem (sem
 *  spoiler). status: done = concluída; offer = esperando a conversa de início na base; active = em andamento; ready =
 *  cumprida, falta a entrega. goal = o objetivo com a contagem, nas que não estão concluídas. */
export type JournalItem = { id: string; title: string; giver: string; status: QuestStage; goal?: string };
export function journal(): { track: Track; chain: string; items: JournalItem[] }[] {
  const out: { track: Track; chain: string; items: JournalItem[] }[] = [];
  for (const t of TRACKS) {
    const q = slot(t);
    if (!q || secret(q) && q.id === FIRST[t]) continue; // a sequência só aparece no menu depois de descoberta
    const items: JournalItem[] = [];
    for (const m of chainOf(t)) {
      const now = q.stage !== 'done' && m.id === q.id, g = m.goal, count = 'count' in g ? g.count : 1;
      items.push({id: m.id, title: m.title, giver: NAMES[m.giver], status: now ? q.stage : 'done',
                  goal: !now ? undefined : q.stage === 'offer' ? `Fale com ${NAMES[m.giver]} na base`
                      : q.stage === 'ready' ? (m.report === 'field' ? 'Concluindo...' : `Volte à base e fale com ${NAMES[m.giver]}`)
                      : count > 1 ? `${m.text} (${Math.floor(q.n)}/${count})` : m.text});
      if (now) break;
    }
    out.push({track: t, chain: CHAINS[t], items});
  }
  return out;
}
/** as missões de uma sequência, em ordem */
const chainOf = (t: Track) => { const out: Mission[] = []; for (let m = byId.get(FIRST[t]); m; m = m.next ? byId.get(m.next) : undefined) out.push(m); return out; };
/** Refazer (menu de missões): a sequência volta à missão id, com a conversa de início esperando, e segue dali como da
 *  primeira vez. O que já tinha sido entregue nela entra em save.paid antes de voltar: não paga de novo. */
export function replay(track: Track, id: string) {
  const q = slot(track), chain = chainOf(track).map(m => m.id);
  if (!q || !chain.includes(id)) return;
  save.paid = [...new Set([...save.paid ?? [], ...chain.slice(0, q.stage === 'done' ? chain.length : chain.indexOf(q.id))])];
  set(track, {id, stage: 'offer', n: 0});
}
/** pula a sequência principal inteira */
export const skipAll = () => { save.quest = {...DONE}; };
