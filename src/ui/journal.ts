// A lista de missões, a mesma no menu de missões (J) e na aba Missões do hangar: cada sequência liberada, com as
// missões concluídas e a atual. Na atual, quando dá para pegar ou entregar na base, um botão "Aceitar" ou "Entregar"
// (só funciona dentro da zona segura). Cada sequência é um <details>: o título abre e fecha a lista (só a primeira começa
// aberta; o que o jogador abre ou fecha fica em opened, enquanto a página estiver aberta), e um botão no título passa a
// acompanhá-la (o objetivo dela tem a vez no painel e no marcador do mapa).
import { journal, pin, board, replay } from '../game/missions.ts';
import type { Track } from '../game/missions.ts';
import { atBase, persist } from '../game/state.ts';

/** quem abre a conversa de uma sequência (ui/missions.ts liga isto): aceitar, entregar ou refazer */
export const missionHooks = {open: (_track: Track) => {}};
const STATUS: Record<string, [string, string]> = {done: ['Concluída', 'done'], offer: ['Disponível', 'offer'], active: ['Em andamento', 'active'], ready: ['Pronta para entregar', 'ready']};
// abertas e fechadas pelo jogador; sem escolha dele, só a primeira sequência começa aberta
const opened = new Map<Track, boolean>();
// Refazer/Recomeçar: só rodando na própria máquina (testes do autor). Para um jogador, quem refaz ou zera as missões é o
// administrador, direto na conta (tools/missoes-piloto.ts).
const DEV = location.hostname === 'localhost';

export function journalHtml() {
  const chains = journal(), takes = new Map(board().map(b => [b.track, b.kind]));
  const live = chains.filter(c => c.items.some(i => i.status !== 'done')), shown = pin.track ?? live[0]?.track;
  if (!chains.length) return '<div class="jr"><p>Nenhuma missão ainda. As disponíveis aparecem aqui e no hangar, na aba Missões.</p></div>';
  const away = atBase() ? '' : 'disabled title="Só na zona segura da base"';
  return `<div class="jr">${chains.map((c, n) => {
    const on = c.items.some(i => i.status !== 'done'), take = takes.get(c.track);
    const again = !DEV ? '' : `<button class="play" data-play="${c.track}" data-id="${c.items[0].id}" title="${on ? 'Recomeçar a sequência desde a primeira missão' : 'Jogar a sequência de novo'} (a recompensa só é paga uma vez)">${on ? 'Recomeçar' : 'Refazer'}</button>`;
    return `<details class="${c.track === shown && on ? 'on' : ''}" data-track="${c.track}" ${opened.get(c.track) ?? n === 0 ? 'open' : ''}>
      <summary><h3>${c.chain}${on ? `<button data-pin="${c.track}" ${c.track === shown ? 'disabled' : ''}>${c.track === shown ? 'Acompanhando' : 'Acompanhar'}</button>` : '<em>Concluída</em>'}${again}</h3></summary>
      <ol>${c.items.map(i => `<li class="${STATUS[i.status][1]}"><b>${i.title}</b><small>${i.giver} · ${STATUS[i.status][0]}</small>${i.goal ? `<span>${i.goal}</span>` : ''}
        ${i.status !== 'done' && take ? `<button class="take" data-take="${c.track}" ${away}>${take === 'offer' ? 'Aceitar' : 'Entregar'}</button>` : ''}</li>`).join('')}</ol>
    </details>`;
  }).join('')}</div>`;
}

/** Clique num botão da lista: devolve true se era dela (quem chama redesenha, se a lista continuar aberta). */
export function journalClick(b: HTMLElement) {
  const d = b.dataset;
  if (d.pin) pin.track = d.pin as Track;
  else if (d.take) { pin.track = d.take as Track; missionHooks.open(d.take as Track); }
  else if (d.play && DEV) { const t = d.play as Track; replay(t, d.id!); pin.track = t; persist(); missionHooks.open(t); }
  else return false;
  return true;
}

/** guarda quais sequências o jogador fechou, para a lista redesenhada manter */
export const trackFolds = (el: HTMLElement) => el.addEventListener('toggle', ev => {
  const d = ev.target as HTMLDetailsElement;
  opened.set(d.dataset.track as Track, d.open);
}, true);
