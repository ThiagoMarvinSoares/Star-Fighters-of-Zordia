// Conversas das missões, o painel de objetivo e as transmissões soltas. O conteúdo das missões e as regras ficam em
// game/missions.ts; aqui é só a tela. As falas são de dentro do jogo (nada de teclas ou interface): os comandos aparecem só
// como dica no painel. A conversa de base abre ao clicar na estação (o "!"); a de campo abre sozinha.
import { MODS } from '../game/data.ts';
import { persist, p } from '../game/state.ts';
import { NAMES, needsTalk, talkNow, fieldTalkNow, talkDone, questGoal, questRadio, skipAll, journal, pin, cue, replay, talkFor } from '../game/missions.ts';
import type { Who, Talk, Track } from '../game/missions.ts';
import { float } from '../game/sim.ts';
import { toggleShop, shopOpen } from './hangar.ts';
import { radio } from '../view/audio.ts';

// Retrato e função de cada personagem: a foto e o recorte (largura e deslocamento, para o rosto caber no quadro 120x140).
// Quem não tem rosto (transmissões, gravações, terminais) aparece como estática, com um rótulo (signal).
// Huedro é o Comandante Augusto; Fabrício, o supervisor de operações, cético e analítico, que questiona até o comandante.
const FACES: Record<Who, { role: string; img?: string; w?: number; x?: number; y?: number; signal?: string }> = {
  huedro: {role: 'Comandante · Aliança de Zordia', img: 'characters/huedro.jpg', w: 230, x: -55, y: -4},
  fabricio: {role: 'Supervisor de Operações · Oficial de Frota', img: 'characters/fabricio.jpg', w: 225, x: -51, y: -2},
  elyra: {role: 'Transmissão · origem desconhecida', signal: 'SINAL'},
  'elyra-log': {role: 'Registro de bordo', signal: 'REGISTRO'},
  heathcliff: {role: 'Gravação de voz', signal: 'GRAVAÇÃO'},
  bordo: {role: 'Nave de Elyra', signal: 'TERMINAL'},
  sistema: {role: 'Estação abandonada', signal: 'TERMINAL'},
};

const el = document.createElement('div');
el.id = 'talk'; el.hidden = true;
el.innerHTML = `<div class="face"><img alt=""><span class="sig"></span></div>
  <div class="body"><div class="who"><b></b><small></small></div>
  <p></p><div class="act"><button class="skip" type="button">Pular tutorial</button>
  <span class="btns"><button class="no" type="button"></button><button class="go" type="button"></button></span></div></div>`;
document.body.append(el);
const box = el.querySelector<HTMLElement>('.face')!, face = el.querySelector('img')!, sig = el.querySelector<HTMLElement>('.sig')!;
const who = el.querySelector('.who b')!, role = el.querySelector('.who small')!, text = el.querySelector('p')!;
const go = el.querySelector<HTMLButtonElement>('.go')!, no = el.querySelector<HTMLButtonElement>('.no')!, skip = el.querySelector<HTMLButtonElement>('.skip')!;
el.addEventListener('mousedown', ev => ev.preventDefault()); // sem foco nos botões: o Espaço continua sendo dos canhões

let talk: Talk | null = null, page = 0, asked = false, hold = 0;
const last = () => page === talk!.lines.length - 1;
function show() {
  const [k, t, wait] = talk!.lines[page], f = FACES[k];
  box.classList.toggle('static', !f.img); sig.textContent = f.signal ?? '';
  if (f.img && face.getAttribute('src') !== f.img) { face.src = f.img; Object.assign(face.style, {width: f.w + 'px', margin: `${f.y}px 0 0 ${f.x}px`}); }
  face.alt = NAMES[k]; who.textContent = t ? NAMES[k] : ''; role.textContent = t ? f.role : ''; text.textContent = t;
  el.classList.toggle('quiet', !t); // silêncio: só a moldura
  if (page === talk!.cue) cue(); // o cenário da missão começa a se mexer
  if (!f.img && t) radio(.08);
  const choose = last() && !!talk!.ask && !asked; // a pergunta: dois botões
  go.textContent = choose ? talk!.ask!.yes : last() ? 'Entendido' : 'Próximo';
  no.hidden = !choose; no.textContent = choose ? talk!.ask!.no : '';
  skip.hidden = talk!.track !== 'main';
  // espera: o botão só libera depois dos segundos da fala
  clearTimeout(hold); go.disabled = no.disabled = wait > 0;
  if (wait > 0) hold = window.setTimeout(() => { go.disabled = no.disabled = false; if (!t) go.click(); }, wait * 1000);
}
function open(t: Talk) {
  if (shopOpen()) toggleShop(false);
  talk = t; page = 0; asked = false; el.hidden = false; show();
}
function finish(answer = true) {
  const shop = !!talk?.shop, track = talk!.track;
  el.hidden = true; talk = null; clearTimeout(hold);
  const got = talkDone(track, answer); persist();
  got.items.forEach((k, i) => float(p, MODS[k].name + ' recebido', '#ffd45a', 3 + i * .3));
  if (got.credits) float(p, `+${got.credits} cr`, '#fd4', 2);
  if (shop) toggleShop(true);
}
go.onclick = () => {
  if (!talk || go.disabled) return;
  if (last() && talk.ask && !asked) { asked = true; talk = {...talk, lines: [...talk.lines, ...talk.ask.then]}; } // respondeu sim: tocam as falas seguintes
  if (++page < talk.lines.length) show(); else finish(true);
};
no.onclick = () => {
  if (!talk || no.disabled) return;
  if (!talk.ask?.otherwise) return finish(false);
  asked = true; talk = {...talk, lines: [...talk.lines, ...talk.ask.otherwise]}; page++; show(); // a outra resposta, com falas próprias
};
skip.onclick = () => { el.hidden = true; talk = null; clearTimeout(hold); skipAll(); persist(); };
addEventListener('keydown', ev => { if (talk && ev.code === 'Enter') go.click(); });

/** Clique na estação: se alguém da base tem algo a dizer, abre a conversa e devolve true (o hangar não abre). */
export function startTalk() {
  if (talk || !needsTalk()) return !!talk;
  const t = talkNow();
  if (!t) return false;
  open(t);
  return true;
}
export const talking = () => !!talk;

// ---------- menu de missões (tecla J ou o botão à direita do inventário) ----------
// Lista cada sequência liberada: as missões concluídas, a atual (em andamento, esperando conversa ou entrega). Clicar
// numa sequência em andamento passa a acompanhá-la: o objetivo dela tem a vez no painel e no marcador do mapa.
const book = document.createElement('div');
book.id = 'quests'; book.hidden = true;
document.body.append(book);
const STATUS: Record<string, [string, string]> = {done: ['Concluída', 'done'], offer: ['Disponível', 'offer'], active: ['Em andamento', 'active'], ready: ['Pronta para entregar', 'ready']};
// Cada sequência é um <details>: o título abre e fecha a lista das missões dela (fechadas ficam em folded, enquanto a
// página estiver aberta). No título, um botão joga a sequência de novo desde a primeira missão.
const folded = new Set<Track>();
const DEV = location.hostname === 'localhost';
function renderBook() {
  const chains = journal();
  const open = chains.filter(c => c.items.some(i => i.status !== 'done')), shown = pin.track ?? open[0]?.track;
  book.innerHTML = `<div class="frame"><header><h2>Missões</h2><button class="x" data-close title="Fechar (J ou Esc)">×</button></header>
    ${chains.length ? chains.map(c => {
      // Refazer/Recomeçar: só rodando na própria máquina (testes do autor). Para um jogador, quem refaz ou zera as missões
      // é o administrador, direto na conta (tools/missoes-piloto.ts).
      const live = c.items.some(i => i.status !== 'done'), again = !DEV ? '' : `<button class="play" data-play="${c.track}" data-id="${c.items[0].id}" title="${live ? 'Recomeçar a sequência desde a primeira missão' : 'Jogar a sequência de novo'} (a recompensa só é paga uma vez)">${live ? 'Recomeçar' : 'Refazer'}</button>`;
      return `<details class="${c.track === shown && live ? 'on' : ''}" data-track="${c.track}" ${folded.has(c.track) ? '' : 'open'}>
        <summary><h3>${c.chain}${live ? `<button data-pin="${c.track}" ${c.track === shown ? 'disabled' : ''}>${c.track === shown ? 'Acompanhando' : 'Acompanhar'}</button>` : '<em>Concluída</em>'}${again}</h3></summary>
        <ol>${c.items.map(i => `<li class="${STATUS[i.status][1]}"><b>${i.title}</b><small>${i.giver} · ${STATUS[i.status][0]}</small>${i.goal ? `<span>${i.goal}</span>` : ''}</li>`).join('')}</ol>
      </details>`;
    }).join('') : '<p>Nenhuma missão ainda. Fale com o Comandante na base.</p>'}</div>`;
}
let bookKey = '';
const toggleBook = (on = book.hidden) => { book.hidden = !on; if (on) { bookKey = ''; renderBook(); } };
book.addEventListener('mousedown', ev => ev.preventDefault());
book.onclick = ev => {
  const b = (ev.target as Element).closest('button'), d = b?.dataset;
  if (!d) return;
  ev.preventDefault(); // botão dentro do título: não abre nem fecha a sequência
  if (d.close !== undefined) toggleBook(false);
  else if (d.pin) { pin.track = d.pin as Track; renderBook(); }
  else if (d.play && !talk && DEV) { // refazer: a conversa de início abre na hora, onde o piloto estiver
    const t = d.play as Track;
    replay(t, d.id!); pin.track = t; persist(); toggleBook(false);
    const c = talkFor(t); if (c) open(c);
  }
};
book.addEventListener('toggle', ev => { const d = ev.target as HTMLDetailsElement; if (d.open) folded.delete(d.dataset.track as Track); else folded.add(d.dataset.track as Track); }, true);
addEventListener('keydown', ev => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.code === 'KeyJ') toggleBook();
  else if (ev.code === 'Escape' && !book.hidden) toggleBook(false);
});
const bookBtn = document.createElement('button');
bookBtn.id = 'questsbtn'; bookBtn.title = 'Missões (J)'; bookBtn.tabIndex = -1;
bookBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 3h10l3 3v15H6zM9 9h7M9 13h7M9 17h4"/></svg><span>J</span>';
bookBtn.addEventListener('mousedown', ev => ev.preventDefault());
bookBtn.onclick = () => toggleBook();
document.body.append(bookBtn);

// painel do objetivo, abaixo do painel do jogador
const goal = document.createElement('div');
goal.id = 'goal'; goal.hidden = true;
document.body.append(goal);
// transmissões soltas (Mission.radio): uma legenda que chia e some, de tempos em tempos
const sub = document.createElement('div');
sub.id = 'radio'; sub.hidden = true;
document.body.append(sub);
let lastGoal = '', nextRadio = 0, radioOff = 0;
export function syncMissions() {
  if (!talk) { const f = fieldTalkNow(); if (f) open(f); } // conversa de campo: abre na hora
  if (!book.hidden) { const k = JSON.stringify(journal()) + pin.track; if (k !== bookKey) { bookKey = k; renderBook(); } } // menu aberto acompanha o progresso
  const g = talk ? null : questGoal(), key = g ? g.who + g.goal + g.hint : '';
  if (key !== lastGoal) {
    lastGoal = key; goal.hidden = !g;
    goal.innerHTML = g ? `<small>${g.who}</small>${g.goal}<em>${g.hint}</em>` : '';
  }
  const now = performance.now(), lines = talk ? null : questRadio();
  if (!lines) { nextRadio = 0; sub.hidden = true; return; }
  if (!nextRadio) nextRadio = now + 8000; // a primeira chega uns segundos depois de a missão começar
  if (now >= nextRadio) {
    const [k, t] = lines[Math.floor(Math.random() * lines.length)];
    sub.innerHTML = `<small>${FACES[k].role}</small>${t}`; sub.hidden = false; radio(.1);
    radioOff = now + 4500; nextRadio = now + 22000 + Math.random() * 14000;
  }
  if (!sub.hidden && now >= radioOff) sub.hidden = true;
}
