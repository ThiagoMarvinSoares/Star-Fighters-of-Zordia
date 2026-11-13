// Ponto de entrada: ajusta o tamanho da tela, carrega o que o mapa precisa (tela de carregamento) e roda o loop
// entrada -> simulação -> desenho.
import { view, world, map } from './game/state.ts';
import { SHIPS, MODS, MODEL_DIR, ORES } from './game/data.ts';
import { keys } from './game/util.ts';
import { pathOf, preload } from './view/ships3d.ts';
import { applyInput } from './ui/input.ts';
import { update } from './game/sim.ts';
import { draw, preloadImages, IMAGES } from './view/render.ts';
import { syncHotbar } from './ui/hotbar.ts';
import { playEvents, preloadSounds } from './view/audio.ts';
import { syncHud } from './ui/hud.ts';
import { enter } from './ui/account.ts';

const cv = document.getElementById('c') as HTMLCanvasElement;
// O canvas tem os pixels reais da tela (até 2x), para as naves saírem nítidas em monitores de alta densidade; o jogo
// continua pensando em pixels CSS (view.w x view.h) e o desenho aplica a escala view.dpr.
const resize = () => {
  view.w = innerWidth; view.h = innerHeight; view.dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
  cv.style.width = view.w + 'px'; cv.style.height = view.h + 'px';
};
addEventListener('resize', resize); resize();

// Título do mapa: surge e some sozinho (animação no style.css), ao carregar a página e a cada troca de mapa.
function showMapTitle(name: string) {
  const el = document.createElement('div');
  el.id = 'map-title'; el.textContent = name;
  el.addEventListener('animationend', () => el.remove());
  document.body.append(el);
}
let titled: string | undefined; // mapa cujo título já foi mostrado

// contador de quadros por segundo, ligado pela tecla F: serve para medir o desempenho em máquinas diferentes
const fps = document.createElement('div');
fps.id = 'fps'; fps.hidden = true; document.body.append(fps);
addEventListener('keydown', ev => { if (ev.code === 'KeyF' && !(ev.target instanceof HTMLInputElement)) fps.hidden = !fps.hidden; });
let frames = 0, since = 0;

// ---------- tela de carregamento ----------
// O jogo só aparece depois que chega TUDO: os modelos do mapa (estação, inimigos, chefe, asteroides), todas as naves e
// todos os itens do hangar, o fundo, as imagens de efeito e os arquivos de som. Assim nada surge aos poucos durante a
// partida nem na primeira vez que o hangar é aberto. Se a rede travar, o jogo abre mesmo assim após WAIT segundos, e o
// que faltar entra quando chegar (até lá aparece o casco genérico).
const WAIT = 90;
const m0 = map();
const models = [...new Set([...(m0.base ? [pathOf('station')] : []), ...keys(SHIPS).map(k => pathOf(k)), ...m0.enemies.map(e => pathOf(e.key)),
                            ...(m0.boss ? [pathOf(m0.boss.def.key)] : []), ...m0.ores.map(o => 'asteroids/' + ORES[o].model),
                            ...keys(MODS).flatMap(k => MODS[k].model ? [`${MODEL_DIR[MODS[k].type]}/${MODS[k].model}`] : [])])];
const screen = document.getElementById('loading'), total = models.length + IMAGES + 1; // + 1 = os sons, contados juntos
let done = 0;
const tick = () => {
  done++;
  if (!screen) return;
  screen.querySelector<HTMLElement>('i')!.style.width = `${done / total * 100}%`;
  screen.querySelector('p')!.textContent = `Carregando ${done} de ${total}`;
};
const assets = Promise.race([Promise.all([preload(models, tick), preloadImages(m0.bg, tick), preloadSounds().then(tick)]), new Promise(ok => setTimeout(ok, WAIT * 1000))]);
await enter(screen); // conta do piloto: entra, cria ou segue sem conta, enquanto os arquivos carregam por trás
await assets;
if (screen) { screen.classList.add('done'); screen.addEventListener('transitionend', () => screen.remove()); }

let last = 0;
requestAnimationFrame(function loop(ts) {
  if (++frames && ts - since >= 500) { fps.textContent = `${Math.round(frames * 1000 / (ts - since))} fps`; frames = 0; since = ts; }
  if (titled !== world.map) { titled = world.map; showMapTitle(map().name); }
  applyInput();
  update(Math.min(.05, (ts - last) / 1000)); last = ts;
  draw();
  syncHotbar();
  syncHud();
  playEvents();
  requestAnimationFrame(loop);
});
