// Ponto de entrada: ajusta o tamanho da tela e roda o loop entrada -> simulação -> desenho.
import { view, world, map } from './game/state.ts';
import { applyInput } from './ui/input.ts';
import { update } from './game/sim.ts';
import { draw } from './view/render.ts';
import { syncHotbar } from './ui/hotbar.ts';
import { playEvents } from './view/audio.ts';
import { syncHud } from './ui/hud.ts';

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
addEventListener('keydown', ev => { if (ev.code === 'KeyF') fps.hidden = !fps.hidden; });
let frames = 0, since = 0;

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
