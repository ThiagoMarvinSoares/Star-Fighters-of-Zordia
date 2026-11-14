// Conversas das missões e o painel de objetivo. O conteúdo das missões e as regras ficam em game/missions.ts; aqui é só a
// tela. As falas são de dentro do jogo (nada de teclas ou interface): os comandos aparecem só como dica no painel.
// A conversa abre ao clicar na estação quando alguém tem algo a dizer (o "!" sobre a base).
import { MODS } from '../game/data.ts';
import { persist, p } from '../game/state.ts';
import { NAMES, needsTalk, talkNow, talkDone, questGoal, restart, skipAll } from '../game/missions.ts';
import type { Who } from '../game/missions.ts';
import { float } from '../game/sim.ts';
import { toggleShop } from './hangar.ts';

// Retrato e função de cada personagem: a foto e o recorte (largura e deslocamento, para o rosto caber no quadro 120x140).
// Huedro é o Comandante Augusto; Fabrício, o supervisor de operações, cético e analítico, que questiona até o comandante.
const FACES: Record<Who, { role: string; img: string; w: number; x: number; y: number }> = {
  huedro: {role: 'Comandante · Aliança de Zordia', img: 'characters/huedro.jpg', w: 230, x: -55, y: -4},
  fabricio: {role: 'Supervisor de Operações · Oficial de Frota', img: 'characters/fabricio.jpg', w: 225, x: -51, y: -2},
};

const el = document.createElement('div');
el.id = 'talk'; el.hidden = true;
el.innerHTML = `<div class="face"><img alt=""></div>
  <div class="body"><div class="who"><b></b><small></small></div>
  <p></p><div class="act"><button class="skip" type="button">Pular tutorial</button><button class="go" type="button"></button></div></div>`;
document.body.append(el);
const face = el.querySelector('img')!, who = el.querySelector('.who b')!, role = el.querySelector('.who small')!, text = el.querySelector('p')!;
const go = el.querySelector<HTMLButtonElement>('.go')!, skip = el.querySelector<HTMLButtonElement>('.skip')!;
el.addEventListener('mousedown', ev => ev.preventDefault()); // sem foco nos botões: o Espaço continua sendo dos canhões

let talk: ReturnType<typeof talkNow> = null, page = 0;
function show() {
  const [k, t] = talk!.lines[page], f = FACES[k];
  if (face.getAttribute('src') !== f.img) { face.src = f.img; face.alt = NAMES[k]; Object.assign(face.style, {width: f.w + 'px', margin: `${f.y}px 0 0 ${f.x}px`}); }
  who.textContent = NAMES[k]; role.textContent = f.role; text.textContent = t;
  go.textContent = page < talk!.lines.length - 1 ? 'Próximo' : 'Entendido';
}
function finish() {
  const shop = !!talk?.shop;
  el.hidden = true; talk = null;
  const got = talkDone(); persist();
  got.items.forEach((k, i) => float(p, MODS[k].name + ' recebido', '#ffd45a', 3 + i * .3));
  if (got.credits) float(p, `+${got.credits} cr`, '#fd4', 2);
  if (shop) toggleShop(true);
}
go.onclick = () => { if (!talk) return; if (++page < talk.lines.length) show(); else finish(); };
skip.onclick = () => { el.hidden = true; talk = null; skipAll(); persist(); };
addEventListener('keydown', ev => { if (talk && ev.code === 'Enter') go.click(); });

/** Clique na estação: se alguém da base tem algo a dizer, abre a conversa e devolve true (o hangar não abre). */
export function startTalk() {
  if (talk || !needsTalk()) return !!talk;
  talk = talkNow();
  if (!talk) return false;
  page = 0; el.hidden = false; show();
  return true;
}
export const talking = () => !!talk;

// botão ao lado do inventário: recomeça as missões do início e já abre a primeira conversa, em qualquer lugar
const again = document.createElement('button');
again.id = 'tutorial'; again.title = 'Tutorial: rever a conversa com o Comandante desde o início'; again.tabIndex = -1; again.textContent = '?';
again.addEventListener('mousedown', ev => ev.preventDefault()); // sem foco: senão o Espaço "clicaria" nele
again.onclick = () => { if (talk) return; restart(); persist(); startTalk(); };
document.body.append(again);

// painel do objetivo, abaixo do painel do jogador
const goal = document.createElement('div');
goal.id = 'goal'; goal.hidden = true;
document.body.append(goal);
let lastGoal = '';
export function syncMissions() {
  const g = talk ? null : questGoal(), key = g ? g.who + g.goal + g.hint : '';
  if (key === lastGoal) return;
  lastGoal = key; goal.hidden = !g;
  goal.innerHTML = g ? `<small>${g.who}</small>${g.goal}<em>${g.hint}</em>` : '';
}
