// HUD: dois painéis iguais em HTML por cima do canvas. O do jogador (canto inferior esquerdo) mostra a nave em uso,
// créditos, estado dos lasers, vida e escudo; o do alvo (topo, ao centro) aparece quando há um inimigo travado e
// mostra o mesmo dele, com a recompensa. syncHud() roda a cada quadro e só mexe na página quando um valor muda.
import { SHIPS, RANGE } from '../game/data.ts';
import type { ModelKey } from '../game/data.ts';
import { save, stats, p } from '../game/state.ts';
import { dist } from '../game/util.ts';
import { iconOf, onModelLoaded } from '../view/ships3d.ts';

const svg = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const HEART = 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z';
const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 9v6M9 12h6';
const COIN = 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8l3.5 2v4L12 16l-3.5-2v-4z';
const fmt = (n: number) => Math.ceil(n).toLocaleString('pt-BR');

/** o que um painel mostra */
interface Info {
  model: ModelKey; name: string;
  /** linha pequena embaixo do nome; alert a deixa vermelha */
  sub: string; alert: boolean;
  /** valor ao lado da moeda */
  coin: string;
  hp: number; maxHp: number; sh: number; maxSh: number;
}
const panels: { last: Record<string, string> }[] = [];
function panel(id: string) {
  const el = document.createElement('div');
  el.id = id; el.className = 'hudp';
  el.innerHTML = `<div class="box"><div class="pt"><img alt=""></div><div class="hi">
    <div class="r1"><div><b class="nm"></b><small class="sub"></small></div><span class="cr">${svg(COIN)}<b></b></span></div>
    <div class="br hp">${svg(HEART)}<div class="tr"><i></i><span>HP <b></b></span></div></div>
    <div class="br sh">${svg(SHIELD)}<div class="tr"><i></i><span>ESC <b></b></span></div></div></div></div>`;
  document.body.append(el);
  const $ = (q: string) => el.querySelector<HTMLElement>(q)!;
  const img = el.querySelector('img')!, name = $('.nm'), sub = $('.sub'), coin = $('.cr b');
  const hp = $('.hp .tr'), hpTxt = $('.hp b'), sh = $('.sh .tr'), shTxt = $('.sh b');
  const last: Record<string, string> = {}; // último valor escrito em cada campo
  const changed = (k: string, v: string) => last[k] !== v && (last[k] = v, true);
  panels.push({last});
  return {
    /** mostra o painel com estes dados, ou esconde se não houver nada a mostrar */
    set(v: Info | null) {
      if (changed('show', v ? '1' : '')) el.style.display = v ? '' : 'none';
      if (!v) return;
      if (changed('model', v.model)) img.src = iconOf(`ships/${v.model}`, true)!;
      if (changed('name', v.name)) name.textContent = v.name;
      if (changed('sub', v.sub + v.alert)) { sub.textContent = v.sub; sub.classList.toggle('on', v.alert); }
      if (changed('coin', v.coin)) coin.textContent = v.coin;
      // barras: --v é a fração cheia (0..1); o texto fica por cima, à direita
      if (changed('hp', `${fmt(v.hp)} / ${fmt(v.maxHp)}`)) { hpTxt.textContent = last.hp; hp.style.setProperty('--v', String(v.hp / v.maxHp)); }
      if (changed('sh', `${fmt(v.sh)} / ${fmt(v.maxSh)}`)) { shTxt.textContent = last.sh; sh.style.setProperty('--v', String(v.maxSh ? v.sh / v.maxSh : 0)); }
    },
  };
}
const mine = panel('hud'), theirs = panel('target');
onModelLoaded(() => { for (const q of panels) q.last.model = ''; }); // um modelo pode ter chegado: refaz os retratos

export function syncHud() {
  const st = stats(), t = p.target;
  mine.set({model: save.ship, name: SHIPS[save.ship].name, coin: fmt(save.credits) + ' cr',
            sub: p.auto ? 'Mira automática' : p.firing ? 'Lasers ativos' : 'Lasers desligados', alert: p.auto || p.firing,
            hp: p.hp, maxHp: st.maxHp, sh: p.sh, maxSh: st.maxSh});
  const far = t ? dist(p, t) > RANGE : false;
  theirs.set(t && {model: t.t.key, name: t.t.name, coin: fmt(t.t.reward) + ' cr', // a moeda mostra a recompensa
                   sub: far ? 'Fora de alcance' : 'Ao alcance dos lasers', alert: !far,
                   hp: Math.max(0, t.hp), maxHp: t.t.hp, sh: t.sh, maxSh: t.t.sh});
}
