// Barra de atalhos: 10 casas no rodapé (teclas 1..9 e 0). Clicar na casa ou apertar o número usa a casa.
// Casa 1: canhões, de ligar e desligar (acesa em azul = atirando). Da casa 2 em diante, uma casa para cada míssil
// equipado, na ordem em que estão na nave: cada uma lança o míssil dela, com as cargas e a recarga dela.
import { MODS, MODEL_DIR, MISSILE_CD, MISSILE_CHARGES } from '../game/data.ts';
import type { ModKey, ModType } from '../game/data.ts';
import { p, best, save, stats } from '../game/state.ts';
import { iconOf } from '../view/ships3d.ts';

interface Slot {
  name: string;
  /** HTML do ícone; pode mudar com o equipamento (conferido a cada quadro) */
  icon: () => string;
  /** casas de ligar/desligar: está ligada? (acende em azul). Casas de acionar não têm. */
  active?: () => boolean;
  /** casas de acionar: [segundos que faltam, recarga total]; mostra a roda enquanto falta */
  cooldown?: () => [left: number, total: number];
  /** casas com cargas: quantas estão prontas (número no canto); null = não mostra */
  charges?: () => number | null;
  use: () => void;
}

const CANNON = `<svg viewBox="0 0 32 32" width="30" height="30"><g transform="rotate(-35 16 16)">
  <rect x="3" y="11" width="13" height="10" rx="2" fill="#55627a"/>
  <rect x="15" y="14" width="13" height="4" fill="#aab8cc"/>
  <rect x="27" y="13" width="2" height="6" fill="#4cf"/></g></svg>`;
const MULTI = `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="#ff7ad9" stroke-width="2">
  <circle cx="16" cy="9" r="5"/><circle cx="8" cy="22" r="5"/><circle cx="24" cy="22" r="5"/><path d="M16 4v10M11 9h10M8 17v10M3 22h10M24 17v10M19 22h10" stroke-width="1.2"/></svg>`;
// foto de um módulo; sem ele (ou enquanto o modelo não carrega), o desenho reserva
const modIcon = (k: ModKey | undefined, fallback: string) => {
  const m = k && MODS[k], u = m && m.model && iconOf(`${MODEL_DIR[m.type]}/${m.model}`);
  return u ? `<img src="${u}" alt="">` : fallback;
};
const bestIcon = (type: ModType, fallback: string) => modIcon(best(type), fallback);

// As casas de agora: mudam quando o equipamento muda, por isso são montadas a cada uso. Casa i = tecla i+1 (a décima
// responde à tecla 0).
function slots(): Slot[] {
  return [
    // acesa sempre que os lasers estão liberados para atirar: ligados aqui (ou no Espaço) ou pela mira automática (T)
    {name: 'Canhões', icon: () => bestIcon('laser', CANNON), active: () => p.firing || p.auto, use: () => { p.firing = !p.firing; }},
    // um por míssil equipado: o número no canto são as cargas prontas dele; sem nenhuma, a roda conta os segundos até
    // a próxima voltar
    ...save.mods.filter(k => MODS[k].type === 'missile').slice(0, 9).map((k, j): Slot => {
      // com mais de uma carga por míssil, o número no canto diz quantas estão prontas; com uma só, a roda basta
      return {name: MODS[k].name, icon: () => modIcon(k, CANNON), charges: () => MISSILE_CHARGES > 1 ? p.mis[j]?.n ?? 0 : null,
              cooldown: () => [p.mis[j]?.n === 0 ? p.mis[j].t : 0, MISSILE_CD],
              use: () => { p.launch = j; }};
    }),
    // chip de múltiplos alvos, depois dos mísseis e só com ele equipado: de ligar e desligar. É o único chip com casa:
    // o de dano é passivo, vale sempre que está equipado. O ícone é o do próprio Multialvo, não o do "melhor chip".
    ...(stats().multi ? [{name: `Múltiplos alvos (até ${stats().multi + 1})`, icon: () => modIcon(save.mods.find(k => MODS[k].chip === 'multi'), MULTI), active: () => p.multi, use: () => { p.multi = !p.multi; }}] : []),
  ];
}

const el = document.createElement('div');
el.id = 'hotbar';
el.innerHTML = Array.from({length: 10}, (_, i) => `<button data-i="${i}" tabindex="-1" disabled><i></i><b></b><em></em><span>${(i + 1) % 10}</span></button>`).join('');
document.body.append(el);

// sem foco no botão: senão o Espaço "clicaria" nele de novo além de alternar os lasers
el.addEventListener('mousedown', ev => ev.preventDefault());
el.addEventListener('click', ev => {
  const b = (ev.target as HTMLElement).closest('button');
  if (b?.dataset.i) useSlot(+b.dataset.i);
});

export function useSlot(i: number) { slots()[i]?.use(); }

// chamado a cada quadro: liga e desliga as casas conforme o equipamento, acende as ligadas, troca ícones e gira a roda
const lit: boolean[] = [], shown: string[] = [], wheel: string[] = [], count: (number | null)[] = [], named: string[] = [];
export function syncHotbar() {
  const now = slots();
  for (let i = 0; i < 10; i++) {
    const s: Slot | undefined = now[i], name = s?.name ?? '';
    if (name !== named[i]) { named[i] = name; const b = el.children[i] as HTMLButtonElement; b.disabled = !s; b.title = name; }
    const on = !!s?.active?.(), icon = s?.icon() ?? '', [left, total] = s?.cooldown?.() ?? [0, 1];
    const cd = left > 0 ? `${Math.round(left / total * 360)}|${Math.ceil(left)}` : ''; // ângulo da roda | segundos
    if (on !== lit[i]) { lit[i] = on; el.children[i].classList.toggle('on', on); }
    if (icon !== shown[i]) { shown[i] = icon; el.children[i].querySelector('i')!.innerHTML = icon; }
    const n = s?.charges?.() ?? null;
    if (n !== count[i]) { count[i] = n; el.children[i].querySelector('em')!.textContent = n === null ? '' : String(n); }
    if (cd !== wheel[i]) {
      wheel[i] = cd;
      const b = el.children[i].querySelector('b')!, [deg, secs] = cd.split('|');
      b.textContent = secs ?? ''; b.style.background = cd ? `conic-gradient(#000c ${deg}deg, #0000 0)` : '';
    }
  }
}
