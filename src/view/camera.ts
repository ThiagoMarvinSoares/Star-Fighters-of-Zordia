// Câmera inclinada: o mundo continua 2D, só o eixo Y é achatado na tela. TILT = 1 volta ao top-down.
// Só matemática de conversão mundo <-> tela; não desenha nada.
import { p, mouse, view, map } from '../game/state.ts';
import type { Point } from '../game/util.ts';

export const TILT = .55, COSV = Math.sqrt(1 - TILT * TILT);
/** limites do zoom: menor = vê mais longe, maior = nave mais de perto */
export const ZOOM = {min: .6, max: 2.2};
export const toWorld = (): Point => ({x: p.x + (mouse.x - view.w / 2) / view.zoom, y: p.y + (mouse.y - view.h / 2) / TILT / view.zoom});
/** Tamanho da interface (painéis, barra de atalhos, minimapa, textos fixos). scale = o que vale agora: cresce com a
 *  janela e com a preferência do jogador (pref, teclas + e -); main.ts calcula. 1 = o tamanho de uma janela de 1280x720. */
export const ui = {scale: 1, pref: 1};
/** minimapa: retângulo que ele ocupa na tela (canto inferior direito) e k = escala mundo -> minimapa */
export const minimap = () => { const m = map(), w = 180 * ui.scale, k = w / m.w, h = m.h * k, pad = 12 * ui.scale; return {x: view.w - w - pad, y: view.h - h - pad, w, h, k}; };
/** pad = folga em volta da tela, para o que é maior que 60 px não sumir ao encostar na borda */
export const onScreen = (o: Point, pad = 60) => Math.abs(o.x - p.x) < view.w / 2 / view.zoom + pad && Math.abs(o.y - p.y) * TILT < view.h / 2 / view.zoom + pad;
