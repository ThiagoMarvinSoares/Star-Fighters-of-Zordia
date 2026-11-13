// Barra de atalhos: 10 casas no rodapé (teclas 1..9 e 0). Clicar na casa ou apertar o número usa a casa.
// Casa 1: canhões, de ligar e desligar (acesa em azul = atirando). Casa 2: mísseis, de acionar: cada clique lança, e uma
// roda com os segundos mostra a recarga. Para criar outra, adicione uma entrada em SLOTS.
import { MODS, MODEL_DIR, MISSILE_CD } from '../game/data.ts';
import type { ModType } from '../game/data.ts';
import { p, best } from '../game/state.ts';
import { iconOf } from '../view/ships3d.ts';

interface Slot {
  name: string;
  /** HTML do ícone; pode mudar com o equipamento (conferido a cada quadro) */
  icon: () => string;
  /** casas de ligar/desligar: está ligada? (acende em azul). Casas de acionar não têm. */
  active?: () => boolean;
  /** casas de acionar: [segundos que faltam, recarga total]; mostra a roda enquanto falta */
  cooldown?: () => [left: number, total: number];
  use: () => void;
}

const CANNON = `<svg viewBox="0 0 32 32" width="30" height="30"><g transform="rotate(-35 16 16)">
  <rect x="3" y="11" width="13" height="10" rx="2" fill="#55627a"/>
  <rect x="15" y="14" width="13" height="4" fill="#aab8cc"/>
  <rect x="27" y="13" width="2" height="6" fill="#4cf"/></g></svg>`;
// foto do melhor módulo equipado do tipo; sem módulo (ou enquanto o modelo não carrega), o desenho reserva
const bestIcon = (type: ModType, fallback: string) => {
  const k = best(type), m = k && MODS[k], u = m && m.model && iconOf(`${MODEL_DIR[type]}/${m.model}`);
  return u ? `<img src="${u}" alt="">` : k ? fallback : '';
};

// casa i responde à tecla i+1 (a décima responde à tecla 0)
const SLOTS: (Slot | undefined)[] = [
  // acesa sempre que os lasers estão liberados para atirar: ligados aqui (ou no Espaço) ou pela mira automática (T)
  {name: 'Canhões', icon: () => bestIcon('laser', CANNON) || CANNON, active: () => p.firing || p.auto, use: () => { p.firing = !p.firing; }},
  // vazia = nenhum míssil equipado
  {name: 'Mísseis', icon: () => bestIcon('missile', CANNON), cooldown: () => [best('missile') ? Math.max(0, p.mcd) : 0, MISSILE_CD], use: () => { p.launch = true; }},
];

const el = document.createElement('div');
el.id = 'hotbar';
el.innerHTML = Array.from({length: 10}, (_, i) => {
  const s = SLOTS[i];
  return `<button data-i="${i}" tabindex="-1" ${s ? `title="${s.name}"` : 'disabled'}><i></i><b></b><span>${(i + 1) % 10}</span></button>`;
}).join('');
document.body.append(el);

// sem foco no botão: senão o Espaço "clicaria" nele de novo além de alternar os lasers
el.addEventListener('mousedown', ev => ev.preventDefault());
el.addEventListener('click', ev => {
  const b = (ev.target as HTMLElement).closest('button');
  if (b?.dataset.i) useSlot(+b.dataset.i);
});

export function useSlot(i: number) { SLOTS[i]?.use(); }

// chamado a cada quadro: acende as casas ligadas, troca o ícone quando o equipamento muda e gira a roda de recarga
const lit: boolean[] = [], shown: string[] = [], wheel: string[] = [];
export function syncHotbar() {
  SLOTS.forEach((s, i) => {
    const on = !!s?.active?.(), icon = s?.icon() ?? '', [left, total] = s?.cooldown?.() ?? [0, 1];
    const cd = left > 0 ? `${Math.round(left / total * 360)}|${Math.ceil(left)}` : ''; // ângulo da roda | segundos
    if (on !== lit[i]) { lit[i] = on; el.children[i].classList.toggle('on', on); }
    if (icon !== shown[i]) { shown[i] = icon; el.children[i].querySelector('i')!.innerHTML = icon; }
    if (cd !== wheel[i]) {
      wheel[i] = cd;
      const b = el.children[i].querySelector('b')!, [deg, secs] = cd.split('|');
      b.textContent = secs ?? ''; b.style.background = cd ? `conic-gradient(#000c ${deg}deg, #0000 0)` : '';
    }
  });
}
