// Áudio: toca o que a simulação registrou no quadro (events), com os arquivos de public/sfx/ (pacote
// "Sci-Fi Sounds" da Kenney, domínio público). Enquanto um arquivo não carregou (ou se o navegador não toca .ogg),
// cai num som sintetizado equivalente.
import type { ModKey } from '../game/data.ts';
import { events, p } from '../game/state.ts';
import { clamp, rnd } from '../game/util.ts';

const HEAR = 1000; // distância até onde se ouve um evento; o volume cai até zero nela
const MAX_PER_FRAME = 8;

// grupos de sons: nome -> quantas variações existem (arquivos <nome>_000.ogg, _001.ogg, ...)
const BANK = {laserSmall: 5, laserLarge: 5, forceField: 5, impactMetal: 5,
              explosionCrunch: 5, lowFrequency_explosion: 2};
type Sfx = keyof typeof BANK;
// som de cada laser do jogador: [grupo, velocidade]. Velocidade menor = mais grave e pesado.
const SHOT: Record<string, [Sfx, number]> = {L1: ['laserSmall', .9], L2: ['laserLarge', 1.15], L3: ['laserLarge', .8],
  M1: ['laserLarge', .4], M2: ['laserLarge', .4], M3: ['laserLarge', .35], M4: ['laserLarge', .3]}; // míssil: o mesmo som, bem grave, até haver um próprio
const ENEMY_SHOT: [Sfx, number] = ['laserLarge', .65]; // o mesmo laser pesado, bem mais grave

let ac: AudioContext | undefined, master: GainNode, hiss: AudioBuffer;
const buffers: Partial<Record<Sfx, AudioBuffer[]>> = {};
let lastField = 0; // o som do escudo dura quase 1 s: não empilha um por tiro

async function loadBank(a: AudioContext) {
  for (const name of Object.keys(BANK) as Sfx[]) for (let i = 0; i < BANK[name]; i++) {
    try {
      const res = await fetch(`sfx/${name}_00${i}.ogg`);
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) continue;
      (buffers[name] ??= []).push(await a.decodeAudioData(await res.arrayBuffer()));
    } catch { /* arquivo ilegível neste navegador: fica o som sintetizado */ }
  }
}
// o navegador só libera áudio depois de um gesto do jogador
function unlock() {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain(); master.gain.value = .3;
    master.connect(ac.createDynamicsCompressor()).connect(ac.destination); // segura o volume quando muitos sons somam
    hiss = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate); // ruído branco, base dos sons sintetizados
    const d = hiss.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loadBank(ac);
  }
  if (ac.state === 'suspended') ac.resume();
}
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// ---------- arquivos ----------
// toca uma variação sorteada do grupo; devolve false se o grupo ainda não carregou
function sample(a: AudioContext, name: Sfx, vol: number, pan: number, rate = 1) {
  const list = buffers[name];
  if (!list?.length) return false;
  const s = a.createBufferSource(), g = a.createGain(), pn = a.createStereoPanner();
  s.buffer = list[Math.random() * list.length | 0]; s.playbackRate.value = rate;
  g.gain.value = vol; pn.pan.value = pan;
  s.connect(g).connect(pn).connect(master); s.start();
  return true;
}

// ---------- reserva sintetizada ----------
function out(a: AudioContext, src: AudioNode, dur: number, vol: number, pan: number) {
  const t = a.currentTime, g = a.createGain(), pn = a.createStereoPanner();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  pn.pan.value = pan;
  src.connect(g).connect(pn).connect(master);
}
// tom que escorrega de f0 para f1: o "piu" do laser
function tone(a: AudioContext, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, pan: number) {
  const t = a.currentTime, o = a.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  out(a, o, dur, vol, pan); o.start(t); o.stop(t + dur);
}
// ruído filtrado, com o filtro fechando de f0 para f1: impacto (curto) ou explosão (longo e grave)
function noise(a: AudioContext, f0: number, f1: number, dur: number, vol: number, pan: number) {
  const t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter();
  s.buffer = hiss; f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  s.connect(f); out(a, f, dur, vol, pan); s.start(t, Math.random() * .5, dur);
}

// Sons de interface do hangar, sintetizados e baixos: duas notas suaves e curtas.
// Comprar = notas subindo (confirmação); vender = duas notas agudas rápidas (moeda caindo).
export function ui(kind: 'buy' | 'sell') {
  if (!ac || ac.state !== 'running') return;
  const notes = kind === 'buy' ? [523, 784] : [1319, 1760], gap = kind === 'buy' ? .09 : .06;
  notes.forEach((f, i) => {
    const t = ac!.currentTime + i * gap, o = ac!.createOscillator(), g = ac!.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + .22);
    o.connect(g).connect(master); o.start(t); o.stop(t + .23);
  });
}

// chamado a cada quadro, depois da simulação
export function playEvents() {
  if (!ac || ac.state !== 'running') return;
  let n = 0;
  for (const e of events) {
    const dx = e.x - p.x, near = 1 - Math.hypot(dx, e.y - p.y) / HEAR; // 1 = em cima do jogador, 0 = fora de alcance
    if (near <= 0 || ++n > MAX_PER_FRAME) continue;
    const pan = clamp(dx / 700, -1, 1), k = rnd(.94, 1.06); // k varia o tom para sons seguidos não soarem idênticos
    if (e.kind === 'shot') {
      const [name, rate] = e.mine ? SHOT[e.mod as ModKey] ?? SHOT.L1 : ENEMY_SHOT;
      if (sample(ac, name, (e.mine ? .5 : .32) * near, pan, rate * k)) { // + um grave curto por baixo, para o tiro ter peso
        tone(ac, 'sine', 170 * k, 50, .13, (e.mine ? .3 : .26) * near, pan);
        continue;
      }
      if (e.mine) tone(ac, 'sawtooth', 1100 * k, 200 * k, .14, .22 * near, pan);
      else tone(ac, 'square', 520 * k, 110 * k, .18, .12 * near, pan);
    }
    else if (e.kind === 'hit') {
      if (e.shielded) { // tiro absorvido pelo escudo
        if (ac.currentTime - lastField < .15) continue;
        lastField = ac.currentTime;
        if (sample(ac, 'forceField', .22 * near, pan, k)) continue;
      } else if (sample(ac, 'impactMetal', .3 * near, pan, k)) continue; // tiro no casco
      noise(ac, 3000, 800, .07, .18 * near, pan);
    }
    else { // explosão em camadas: estouro (arquivo tocado devagar, para ficar grave e longo), grave de arquivo,
           // um sub-grave sintetizado que desce e uma cauda de ruído que demora a sumir. Nave maior = mais lento e longo.
      const big = e.r >= 30, vol = Math.min(1, .6 + e.r / 50) * near, tail = big ? 2.2 : 1.4;
      sample(ac, 'explosionCrunch', vol, pan, k * (big ? .45 : .6));
      sample(ac, 'lowFrequency_explosion', vol, pan, big ? .7 : .9);
      tone(ac, 'sine', big ? 80 : 100, 26, tail * .6, vol * .8, pan);
      noise(ac, 900, 40, tail, vol * .45, pan);
    }
  }
}
