export interface Point { x: number; y: number }

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Sorteios do jogo: tudo em game/ sorteia por aqui, nunca por Math.random(), para os testes poderem fixar a sequência.
let state = (Math.random() * 2 ** 32) >>> 0; // cada partida começa numa sequência diferente
/** fixa a sequência de sorteios: com a mesma semente, a simulação dá sempre o mesmo resultado (usado nos testes) */
export const seed = (n: number) => { state = n >>> 0; };
/** sorteio em [0, 1) (gerador mulberry32) */
export function rand() {
  state = (state + 0x6D2B79F5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rnd = (a: number, b: number) => a + rand() * (b - a);
/** Object.keys com o tipo das chaves preservado */
export const keys = <T extends object>(o: T) => Object.keys(o) as (keyof T)[];
