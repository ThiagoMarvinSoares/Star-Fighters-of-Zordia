// Medidas dos modelos 3D que as regras do jogo usam: escala, pontos de tiro e bocais dos motores. Os modelos em si são
// os .glb de public/models, carregados por view/ships3d.ts.
// Eixos do modelo: x = frente, y = cima, z = direita. Comprimento 2 (de -1 a 1).
// Para criar uma nave: adicione a chave em data.ts; o compilador cobra a entrada em HARD e em ENGINES.
import type { ModelKey } from './data.ts';
import type { Point } from './util.ts';

export type Vec3 = [x: number, y: number, z: number];

export const SCALE = 1.5; // raio da nave -> tamanho do modelo na tela/mundo
// Onde fica, no mundo, o ponto de fixação h da nave o (raio r): é de lá que o tiro sai.
export function mount(o: Point & { a: number }, r: number, h: Vec3): Point {
  const S = r * SCALE, c = Math.cos(o.a), s = Math.sin(o.a);
  return {x: o.x + (h[0] * c - h[2] * s) * S, y: o.y + (h[0] * s + h[2] * c) * S};
}

// Bocais dos motores, em coordenadas do modelo [x, y, z]: de onde sai a chama. Medidos nos .glb com tools/shade-glb.ts
// (vistas de cima e por trás). Alienígenas orgânicos e a estação não têm motor.
export const ENGINES: Record<ModelKey, Vec3[]> = {
  scout: [[-.88, .06, 0], [-.72, .03, .26], [-.72, .03, -.26]], // bocal grande no centro e dois menores ao lado
  corvette: [[-1, -.08, 0], [-.88, 0, .6], [-.88, 0, -.6]],     // motor central e os dois casulos das asas
  cruiser: [[-.9, .03, 0], [-.92, 0, .49], [-.92, 0, -.49]],    // bloco central e os dois blocos laterais
  interceptor: [[-.97, -.1, .26], [-.97, -.1, -.26]],           // as duas fuselagens grandes
  raider: [[-.98, -.05, 0]],                                    // feixe de bocais no centro da traseira
  dreadnought: [[-.63, .09, .65], [-.63, .09, -.65], [-.57, -.05, .19], [-.57, -.05, -.19]], // os quatro motores
  ferrao: [[-.97, 0, 0]], // bocal na ponta da cauda fina
  northstar: [[-.97, 0, 0]], // o anel do motor, no centro da traseira
  astraeus: [[-.9, -.02, .16], [-.9, -.02, -.16]], // os dois motores da traseira
  furia: [[-.46, .03, 0]], // os motores na traseira do casco (as asas soltas vão além dele)
  unsa: [],
  drone: [], boss: [], station: [],
};

// Pontos de fixação das armas, em coordenadas do modelo: de onde saem os tiros. As armas não são desenhadas na nave.
// Pares [x, z, y] espelhados nos dois lados; um ponto por slot de arma: o laser i dispara do ponto i.
const pairs = (l: [x: number, z: number, y?: number][]) => l.flatMap(([x, z, y = 0]): Vec3[] => [[x, y, z], [x, y, -z]]);
export const HARD: Record<ModelKey, Vec3[]> = {
  scout: [...pairs([[-.3, .95, 0]]), [-.2, .2, 0]], // extremos das asas + um no dorso da fuselagem (posições para o scout.glb)
  corvette: pairs([[-.2, .52, .14], [.35, .17, .15], [-.6, .8, .03]]),
  cruiser: pairs([[-.35, .47, .1], [-.7, .47, .1], [.1, .28, .1], [.5, .28, .1], [.85, .15, .08]]), // blocos laterais de trás e ao longo do casco (posições para o cruiser.glb)
  interceptor: pairs([[-.3, .6, .03], [-.5, .85, .03], [0, .35, .04], [.3, .12, .06], [-.6, .35, .04]]), // ao longo das asas (posições para o interceptor.glb)
  raider: pairs([[.9, .28]]), // pontas das duas hastes da frente (posições para o raider.glb)
  drone: [[.5, .1, 0]], // frente da cúpula (posição para o drone.glb)
  dreadnought: pairs([[.55, .8], [.6, .3]]), // ao longo da frente larga do casco (posições para o dreadnought.glb)
  boss: pairs([[.7, .25], [.4, .45], [.1, .3]]), // espalhados pela cabeça larga (posições para o boss.glb)
  ferrao: pairs([[.45, .12]]), // nas laterais da frente (posições para o ferrao.glb)
  furia: pairs([[.6, .06], [.3, .14]]), // a fileira de canhões ao longo da frente do casco (posições para o furia.glb)
  northstar: pairs([[.1, .6], [.72, .13], [.5, .1], [-.2, .55], [-.55, .55], [.2, .25]]), // canhões das asas e ao longo do casco (posições para o northstar.glb)
  astraeus: pairs([[-.3, .53, -.17], [-.1, .69, -.19], [.1, .7, -.2], [.3, .67, -.19], [.5, .6, -.18], [.45, .07, 0], [-.15, .13, 0]]), // ao longo da asa em meia-lua e do casco central (posições para o astraeus.glb)
  unsa: [],
  station: [],
};

// P.E.T.s (data.ts, módulos do tipo 'pet'): de onde saem os tiros, por modelo (public/models/pets/<modelo>.glb), nas
// mesmas coordenadas das naves. Medidos nos .glb: a lente na frente (Mk1 a Mk3) e as pontas dos dois canos (Mk4).
export const PET_GUNS: Record<string, Vec3[]> = {
  pet1: [[.97, 0, 0]],
  pet2: [[.95, 0, 0]],
  pet3: [[.53, 0, 0]],
  pet4: [[.55, -.31, .65], [.55, -.31, -.65]],
};
