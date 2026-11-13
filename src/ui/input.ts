// Entrada: mouse e teclado. Só registra a intenção do jogador no estado; quem decide o resultado é sim.ts.
import { STATION_R } from '../game/data.ts';
import { save, persist, p, enemies, rocks, mouse, map, atBase, view } from '../game/state.ts';
import { MINE_RANGE } from '../game/data.ts';
import { dist } from '../game/util.ts';
import { TILT, ZOOM, toWorld, minimap } from '../view/camera.ts';
import { float } from '../game/sim.ts';
import { SCALE } from '../game/models.ts';
import { toggleShop, shopOpen, renderShop } from './hangar.ts';
import { useSlot } from './hotbar.ts';

document.getElementById('c')!.addEventListener('mousedown', ev => {
  if (ev.button !== 0) return; // só o botão esquerdo: o menu de contexto engole o mouseup
  mouse.x = ev.clientX; mouse.y = ev.clientY;
  const mm = minimap(), ux = (mouse.x - mm.x) / mm.w, uy = (mouse.y - mm.y) / mm.h;
  if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1) { p.tx = ux * map().w; p.ty = uy * map().h; return; } // clique no minimapa: voa até aquele ponto do mapa
  const w = toWorld();
  const e = enemies.find(e => Math.hypot(e.x - w.x, (e.y - w.y) * TILT) < e.t.r * SCALE + 8); // o tamanho com que o modelo é desenhado
  if (e) { p.target = e; return; }
  // clique num asteroide: escolhe para minerar e voa até uma distância boa dele (o feixe liga ao chegar, ver sim.ts)
  const k = rocks.find(k => Math.hypot(k.x - w.x, (k.y - w.y) * TILT) < k.r * SCALE);
  p.mining = k ?? null; // qualquer outro clique desiste da mineração
  if (k) {
    const d = dist(p, k), stop = MINE_RANGE * .6;
    if (d > stop) { p.tx = k.x + (p.x - k.x) / d * stop; p.ty = k.y + (p.y - k.y) / d * stop; }
    return;
  }
  // clique na estação com a nave dentro da zona segura: abre o hangar (de fora, o clique só manda voar até lá;
  // para consultar o inventário longe da base há a tecla B e o botão ao lado da barra de atalhos)
  if (atBase() && dist(w, map().base!) < STATION_R * SCALE) { toggleShop(true); return; }
  mouse.held = true;
});
addEventListener('mousemove', ev => { mouse.x = ev.clientX; mouse.y = ev.clientY; });
// roda do mouse sobre o jogo: aproxima ou afasta a câmera da nave, 10% por passo
document.getElementById('c')!.addEventListener('wheel', ev => {
  ev.preventDefault();
  view.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
}, {passive: false});
addEventListener('mouseup', () => mouse.held = false);

addEventListener('keydown', ev => {
  if (ev.target instanceof HTMLInputElement) return; // digitando (login do piloto): as teclas não são comandos do jogo
  const digit = /^Digit(\d)$/.exec(ev.code); // teclas 1..9 e 0 = casas da barra de atalhos
  if (digit) { if (!ev.repeat) useSlot((+digit[1] + 9) % 10); } // tecla segurada não repete: um aperto, um uso
  else if (ev.code === 'Space') { ev.preventDefault(); p.firing = !p.firing; }
  else if (ev.code === 'KeyT') p.auto = !p.auto;
  else if (ev.code === 'KeyB') toggleShop(!shopOpen());
  else if (ev.code === 'Escape') toggleShop(false);
  else if (ev.code === 'KeyM' && location.hostname === 'localhost') { // trapaça de teste: só rodando na própria máquina
    save.credits += 20000; persist(); float(p, '+20000 cr', '#fd4', 1.5);
    if (shopOpen()) renderShop();
  }
});

// chamado a cada quadro, antes da simulação: com o botão segurado, a nave segue o mouse
let deaths = 0;
export function applyInput() {
  if (deaths !== p.deaths) { deaths = p.deaths; mouse.held = false; } // morreu: não sai da base atrás do mouse
  if (mouse.held) { const w = toWorld(); p.tx = w.x; p.ty = w.y; }
}
