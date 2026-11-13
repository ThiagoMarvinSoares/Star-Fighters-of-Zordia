// Hangar e inventário (HTML por cima do canvas), em três abas. Abre em qualquer lugar (tecla B ou o botão ao lado da
// barra de atalhos), mas fora da zona segura da base é só consulta: comprar, vender, equipar e trocar de nave ficam
// desligados. Abas: Equipamento: a nave à esquerda, as casas de equipamento por tipo no
// meio e o inventário (itens guardados) à direita. Naves: escolher e comprar naves. Loja: comprar módulos, por categoria.
// As regras de compra, venda e equipar ficam em state.ts; aqui é só a tela.
import { SHIPS, MODS, ORES, ORE_STACK, LABEL, SLOT, SLOT_ONE, MODEL_DIR, ACCURACY } from '../game/data.ts';
import type { ModDef, ModKey, ModType, OreKey, ShipDef, ShipKey } from '../game/data.ts';
import { save, stats, count, freeSlot, buyMod, sellMod, equip, unequip, buyShip, useShip, cargoUsed, cargoValue, sellOre, sellCargo, atBase } from '../game/state.ts';
import { keys } from '../game/util.ts';
import { TILT } from '../view/camera.ts';
import { createStage, iconOf, onModelLoaded } from '../view/ships3d.ts';
import { ui } from '../view/audio.ts';
import { accountHtml, accountAction } from './account.ts';

const el = document.getElementById('shop')!;
const slotText = (f: (t: ModType) => number) => keys(SLOT).map(t => `${f(t)} ${f(t) === 1 ? SLOT_ONE[t] : SLOT[t]}`).join(' · ');
const cr = (n: number) => n.toLocaleString('pt-BR') + ' cr';

// ícones desenhados à mão: caminhos SVG de traço, viewBox 24x24
const I = {
  hangar: 'M2 20h20M4 20V11l8-6 8 6v9M8 20v-5h8v5',
  coin: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8l3.5 2v4L12 16l-3.5-2v-4z',
  close: 'M6 6l12 12M18 6L6 18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  ship: 'M12 2l2.5 7 7.5 5-7 1.5L12 22l-3-6.5L2 14l7.5-5z',
  chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  left: 'M15 4l-8 8 8 8',
  right: 'M9 4l8 8-8 8',
  slots: 'M4 5h16v14H4zM4 12h16M12 5v14',
  cart: 'M2 4h3l2.5 11h11L21 7H6.5M9 20h1M17 20h1',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  target: 'M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM12 2v5M12 17v5M2 12h5M17 12h5',
  speed: 'M4 6l6 6-6 6M12 6l6 6-6 6',
  laser: 'M4 20l3-3M7 17l10-10 3 3-10 10zM17 7l1-4 3 3-4 1',
  engine: 'M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z',
  missile: 'M20 4c0 5-2 8-5 11l-6-6c3-3 6-5 11-5zM9 9l-4 1-2 3 4 1M15 15l-1 4-3 2-1-4M5 19l3-3',
  mining: 'M4 20l9-9M9 5c5-2 9 0 11 4-3-2-6-2-8-1zM11 7l5 5',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const ICON: Record<ModType, string> = {laser: I.laser, shield: I.shield, engine: I.engine, aim: I.target, missile: I.missile, mining: I.mining, chip: I.chip};
// ícone de um módulo: a foto do modelo 3D dele; enquanto o .glb não carrega (ou se não existe), o desenho do tipo
const pic = (k: ModKey) => { const m = MODS[k], u = m.model && iconOf(`${MODEL_DIR[m.type]}/${m.model}`); return u ? `<img src="${u}" alt="">` : svg(ICON[m.type]); };

// teto das barras: o máximo que qualquer nave alcança com os melhores módulos
const best = (t: ModType) => Math.max(...keys(MODS).filter(k => MODS[k].type === t).map(k => MODS[k].val));
const top = (f: (s: ShipDef) => number) => Math.max(...keys(SHIPS).map(k => f(SHIPS[k])));
const pct = (acc: number) => Math.round(acc * 100);
const CAP = {hp: top(s => s.hp), sh: top(s => s.slots.shield * best('shield')),
             dmg: top(s => s.slots.laser * best('laser')), speed: top(s => s.speed + s.slots.engine * best('engine')), cargo: top(s => s.cargo)};

type Tab = 'gear' | 'ships' | 'store';
let tab: Tab = 'gear';
let shown: ShipKey = save.ship;            // aba Naves: nave escolhida (a prévia grande mostra ela)
let cat: ModType = 'laser', pick: ModKey = 'L1'; // aba Loja: categoria aberta e item escolhido
// aba Equipamento: item selecionado, da nave ('mods') ou do inventário ('inv')
type From = 'mods' | 'inv';
let sel: { from: From; i: number } | null = null;
let lastClick = {key: '', t: 0}; // para reconhecer o duplo clique mesmo com a tela sendo redesenhada entre os dois
const TYPE_NAME: Record<ModType, string> = {laser: 'Arma', shield: 'Gerador de escudo', engine: 'Motor', aim: 'Computador de mira', missile: 'Míssil', mining: 'Módulo de mineração', chip: 'Chip'};

// motivo para desligar tudo que mexe no equipamento ou nos créditos: vazio na base, preenchido fora dela.
// É só o aviso na tela: quem barra de verdade são as regras em state.ts.
const away = () => atBase() ? '' : 'Só na zona segura da base';
// o efeito de um item, como aparece nas fichas: "+25 de dano", ou o texto próprio do item
const effect = (m: ModDef) => m.effect ?? `+${m.val}${LABEL[m.type]}`;
// atributo disabled com o motivo no tooltip; why vazio = liberado
const off = (why: string) => why ? `disabled title="${why}"` : '';

// nave atual: atributos com módulos (stats()); outras: valores de fábrica
function bars(k: ShipKey) {
  const s = k === save.ship ? stats() : {maxHp: SHIPS[k].hp, maxSh: 0, dmg: 0, speed: SHIPS[k].speed, acc: ACCURACY, cargo: SHIPS[k].cargo};
  const rows: [string, string, number, number][] = [[I.heart, 'Vida', s.maxHp, CAP.hp], [I.shield, 'Escudo', s.maxSh, CAP.sh],
                                                    [I.laser, 'Dano', s.dmg, CAP.dmg], [I.target, 'Precisão (%)', pct(s.acc), 100], [I.speed, 'Velocidade', s.speed, CAP.speed], [I.box, 'Porão', s.cargo, CAP.cargo]];
  return rows.map(([ic, n, v, c]) => `<div class="st">${svg(ic)}<span>${n}</span><b>${v.toLocaleString('pt-BR')}</b><div class="bar"><i style="width:${Math.min(100, v / c * 100)}%"></i></div></div>`).join('');
}

const PW = 238, PH = 220; // tamanho da prévia na tela, em px CSS (igual ao do canvas no style.css)
// painel da esquerda, igual em Equipamento e Naves: a nave grande girando, nome, slots e atributos
function shipPane(k: ShipKey) {
  const s = SHIPS[k], dpr = devicePixelRatio || 1;
  return `<div class="left"><canvas width="${Math.round(PW * dpr)}" height="${Math.round(PH * dpr)}"></canvas>
    <div class="nm">${svg(I.ship)}<div><b>${s.name}</b><small>${slotText(t => s.slots[t])}</small></div></div>${bars(k)}</div>`;
}

// ---------- aba Equipamento ----------
// casa com um item: quadrado com o ícone, borda na cor do tipo; todas do mesmo tamanho, ocupadas ou vazias
const cell = (from: From, i: number, k: ModKey) => { const m = MODS[k]; return `<button class="cell t-${m.type}${sel?.from === from && sel.i === i ? ' on' : ''}"
  data-from="${from}" data-i="${i}" title="${m.name} · ${effect(m)}">${pic(k)}</button>`; };
const empties = (n: number) => '<span class="cell empty"></span>'.repeat(Math.max(0, n));
// Grupos recolhíveis (nave e inventário): clicar no título esconde ou mostra as casas. Não é salvo: ao recarregar a
// página, tudo volta aberto. id = 'mods-<tipo>' ou 'inv-<tipo>'; lock = título sem o que recolher (grupo vazio).
const folded = new Set<string>();
const head = (id: string, t: ModType, n: string | number, lock = false) =>
  `<h4><button class="fold${folded.has(id) ? ' shut' : ''}" data-fold="${id}" ${lock ? 'disabled' : `title="${folded.has(id) ? 'Mostrar' : 'Recolher'}"`}>${svg(I.right)}${SLOT[t]}<em>${n}</em></button></h4>`;
// índices, na lista from, dos itens do tipo t (as casas guardam o índice original, que é o que equipar e vender usam)
const ofType = (from: From, t: ModType) => save[from].flatMap((m, i) => MODS[m].type === t ? [i] : []);
// um grupo por tipo, com uma casa por slot da nave; os itens equipados ocupam as primeiras
function slotGroups() {
  const st = stats();
  return keys(SLOT).map(t => {
    const idx = ofType('mods', t), id = 'mods-' + t;
    return `<section class="t-${t}">${head(id, t, `${idx.length}/${st.slots[t]}`)}${folded.has(id) ? '' :
      `<div class="cells">${idx.map(i => cell('mods', i, save.mods[i])).join('')}${empties(st.slots[t] - idx.length)}</div>`}</section>`;
  }).join('');
}
// detalhes e ações do item selecionado; a caixa tem altura fixa, com ou sem seleção
// minério do porão no inventário: empilhado em packs de ORE_STACK, uma casa por pack, com a quantidade no canto
let oreSel: { ore: OreKey; s: number; n: number } | null = null; // pack selecionado: minério, posição na pilha e quantidade
const orePic = (k: OreKey) => { const u = iconOf('asteroids/' + ORES[k].model); return u ? `<img src="${u}" alt="">` : svg(I.box); };
function oreGroup() {
  const id = 'inv-ore', cells = keys(ORES).flatMap(k => {
    const total = Math.floor(save.cargo[k]);
    return Array.from({length: Math.ceil(total / ORE_STACK)}, (_, s) => { const n = Math.min(ORE_STACK, total - s * ORE_STACK);
      return `<button class="cell ore${oreSel?.ore === k && oreSel.s === s ? ' on' : ''}" data-ore="${k}" data-s="${s}" data-n="${n}" style="--k:${ORES[k].color}" title="${ORES[k].name} · ${n}">${orePic(k)}<em>${n}</em></button>`; });
  });
  return `<div class="grp t-mining${cells.length ? '' : ' none'}"><h4><button class="fold${folded.has(id) ? ' shut' : ''}" data-fold="${id}" ${cells.length ? '' : 'disabled'}>${svg(I.right)}minérios<em>${Math.floor(cargoUsed())}/${stats().cargo}</em></button></h4>${
    folded.has(id) || !cells.length ? '' : `<div class="cells g4">${cells.join('')}</div>`}</div>`;
}
function oreDetail(o: NonNullable<typeof oreSel>) {
  const d = ORES[o.ore], total = Math.floor(save.cargo[o.ore]);
  return `<div class="det ore" style="--k:${d.color}"><span class="ic">${orePic(o.ore)}</span>
    <div><b>${d.name}</b><small>Pack de ${o.n} · ${total} no porão</small><small class="pr">${svg(I.coin)}${cr(d.price)} por unidade</small></div>
    <div class="btns"><button class="sell" data-do="sellpack" ${off(away())}>Vender pack · ${cr(o.n * d.price)}</button>
      <button class="sell" data-do="sellores" ${off(away())}>Vender tudo · ${cr(cargoValue())}</button></div></div>`;
}
function detail() {
  if (oreSel) return oreDetail(oreSel);
  const k = sel && save[sel.from][sel.i];
  if (!sel || !k) return '<div class="det hint">Clique num item para ver os detalhes.<br><br>Duplo clique: equipa ou desequipa.<br>Para comprar, use a aba Loja.</div>';
  const m = MODS[k];
  const move = sel.from === 'inv' ? `<button class="buy" data-do="equip" ${off(away() || (freeSlot(m.type) ? '' : `Sem slot livre de ${SLOT[m.type]}`))}>Equipar</button>`
                                  : `<button class="buy" data-do="unequip" ${off(away())}>Desequipar</button>`;
  return `<div class="det t-${m.type}"><span class="ic">${pic(k)}</span>
    <div><b>${m.name}</b><small>${effect(m)}</small><small class="pr">${svg(I.coin)}${cr(m.cost)}</small></div>
    <div class="btns">${move}<button class="sell" data-do="sell" ${off(away())}>Vender · ${cr(m.cost / 2)}</button></div></div>`;
}
// inventário: itens comprados e guardados, separados pelas mesmas categorias da loja. Todas aparecem, na mesma ordem,
// mesmo vazias (apagadas), para cada tipo ter sempre o seu lugar; a lista rola dentro de uma altura fixa.
function inventory() {
  const groups = keys(SLOT).map(t => {
    const idx = ofType('inv', t), id = 'inv-' + t;
    return `<div class="grp t-${t}${idx.length ? '' : ' none'}">${head(id, t, idx.length, !idx.length)}${folded.has(id) || !idx.length ? '' :
      `<div class="cells g4">${idx.map(i => cell('inv', i, save.inv[i])).join('')}</div>`}</div>`;
  }).join('');
  return `<aside><h4>${svg(I.slots)}Inventário<em>${save.inv.length}</em></h4><div class="inv">${oreGroup()}${groups}</div>${detail()}</aside>`;
}
const gearTab = () => `<div class="gear">${shipPane(save.ship)}<div class="mid">${slotGroups()}</div>${inventory()}</div>`;

// ---------- aba Naves ----------
// mesmo desenho da aba Equipamento: a nave escolhida grande à esquerda; à direita a lista de naves, com comprar
// (as que faltam) ou usar (as que já estão no hangar)
function shipsTab() {
  const rows = keys(SHIPS).map(k => `<button class="srow${k === shown ? ' on' : ''}" data-ship-pick="${k}"><img class="shp" src="${iconOf(`ships/${k}`, true)}" alt="">
    <span><b>${SHIPS[k].name}</b><small>${slotText(t => SHIPS[k].slots[t])}</small></span>
    ${k === save.ship ? '<span class="badge">Em uso</span>' : save.owned.includes(k) ? '<span class="badge has">No hangar</span>' : `<span class="pr">${cr(SHIPS[k].cost)}</span>`}</button>`).join('');
  const s = SHIPS[shown], note = `${s.name} · atributos de fábrica, sem módulos.<br>Ao trocar de nave, os módulos da nave em uso vão para o inventário.`;
  const buy = shown === save.ship ? '<span>Esta é a nave em uso. Os atributos ao lado já contam os módulos equipados.</span>'
    : save.owned.includes(shown) ? `<span>${note}</span><button class="buy" data-use="${shown}" ${off(away())}>Usar esta nave</button>`
    : `<span>${note}</span><button class="buy" data-ship="${shown}" ${off(away() || (save.credits < s.cost ? 'Créditos insuficientes' : ''))}>Comprar · ${cr(s.cost)}</button>`;
  return `<div class="gear two">${shipPane(shown)}<div class="mid"><section><h4>${svg(I.ship)}Naves</h4><div class="slist">${rows}</div></section>
    <div class="buybox">${buy}</div></div></div>`;
}

// ---------- aba Loja ----------
// categorias à esquerda, itens da categoria no meio e, à direita, o item escolhido em destaque com dados e compra
function storeTab() {
  const list = keys(MODS).filter(k => MODS[k].type === cat && !MODS[k].drop); // itens de espólio não estão à venda
  if (!list.includes(pick)) pick = list[0];
  const m = MODS[pick], st = stats();
  const cats = keys(SLOT).map(t => `<button class="t-${t}${t === cat ? ' on' : ''}" data-cat="${t}">${svg(ICON[t])}${SLOT[t]}</button>`).join('');
  const tiles = list.map(k => `<button class="tile t-${cat}${k === pick ? ' on' : ''}" data-item="${k}">
    <b>${MODS[k].name}</b><span class="im">${pic(k)}</span><span class="pr">${cr(MODS[k].cost)}</span></button>`).join('');
  return `<div class="store"><div class="cats">${cats}</div><div class="tiles">${tiles}</div>
    <div class="show t-${m.type}"><h3>${m.name}</h3><small>${TYPE_NAME[m.type]}</small><div class="big">${pic(pick)}</div>
      <dl><dt>Efeito</dt><dd>${effect(m)}</dd>
        <dt>Valor de revenda</dt><dd>${cr(m.cost / 2)}</dd>
        <dt>Equipados na nave</dt><dd>${save.mods.filter(x => x === pick).length}</dd>
        <dt>No inventário</dt><dd>${save.inv.filter(x => x === pick).length}</dd>
        <dt>Slots de ${SLOT[m.type]} em uso</dt><dd>${count(m.type)}/${st.slots[m.type]}</dd></dl>
      <div class="price">${cr(m.cost)}</div>
      <button class="buy" data-buy="${pick}" ${off(away() || (save.credits < m.cost ? 'Créditos insuficientes' : ''))}>Comprar</button>
      <small class="note">${freeSlot(m.type) ? 'Há slot livre: vai direto para a nave.' : 'Slots deste tipo cheios: vai para o inventário.'}</small></div></div>`;
}
const TABS: Record<Tab, [name: string, body: () => string]> = {gear: ['Equipamento', gearTab], ships: ['Naves', shipsTab], store: ['Loja', storeTab]};

// prévia 3D girando sobre um anel brilhante: a nave em uso ou, na aba Naves, a nave escolhida
let ang = .7, raf = 0, stage: ReturnType<typeof createStage> | undefined; // palco 3D só da prévia, criado ao abrir
function drawPreview() {
  const cv = el.querySelector('canvas');
  if (!cv) return;
  const g = cv.getContext('2d')!, cx = PW / 2, cy = PH * .6, k = cv.width / PW;
  g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, PW, PH);
  g.save(); g.translate(cx, cy); g.scale(1, TILT);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 104);
  gr.addColorStop(0, 'rgba(60,220,255,.25)'); gr.addColorStop(1, 'rgba(60,220,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 104, 0, 7); g.fill();
  g.strokeStyle = '#3cdcff'; g.lineWidth = 2.5; g.shadowColor = '#3cdcff'; g.shadowBlur = 12; g.stroke();
  g.restore();
  stage ??= createStage();
  // câmera um pouco acima da nave, para ela aparecer em (cx, cy), sobre o anel
  const key = tab === 'ships' ? shown : save.ship;
  stage.render([{id: el, o: {x: 0, y: 0, a: ang}, r: 52, key}],
               {x: 0, y: (PH / 2 - cy) / TILT}, PW, PH, cv.width, cv.height);
  g.drawImage(stage.canvas, 0, 0, PW, PH);
}
// Atualização em tempo real: a cada quadro com a janela aberta, se algo que ela mostra mudou por fora (minério
// entrando no porão, créditos de um abate, a nave entrando ou saindo da base), a tela é refeita. Não durante um
// clique: trocar o botão entre apertar e soltar faria o clique se perder.
let sig = '', pressed = false;
const signature = () => `${save.credits}|${save.ship}|${save.mods}|${save.inv}|${keys(ORES).map(k => Math.floor(save.cargo[k]))}|${atBase()}`;
el.addEventListener('pointerdown', () => { pressed = true; });
addEventListener('pointerup', () => { pressed = false; });
function spin(ts: number) {
  ang = ts / 2500;
  if (!pressed && signature() !== sig) renderShop(); else drawPreview();
  raf = requestAnimationFrame(spin);
}

export function renderShop() {
  sig = signature();
  if (oreSel) { // o pack selecionado acompanha a carga: muda de tamanho, ou some se foi vendido por outro caminho
    const n = Math.min(ORE_STACK, Math.floor(save.cargo[oreSel.ore]) - oreSel.s * ORE_STACK);
    oreSel = n > 0 ? {...oreSel, n} : null;
  }
  const y = el.querySelector('main')?.scrollTop ?? 0, iy = el.querySelector('.inv')?.scrollTop ?? 0; // re-renderizar não volta a rolagem ao topo
  el.innerHTML = `<div class="frame"><header class="hd">${svg(I.hangar)}<h2>HANGAR</h2>
    ${accountHtml()}<span class="cr">${svg(I.coin)}${cr(save.credits)}</span><button class="x" data-close title="Fechar (B ou Esc)">${svg(I.close)}</button></header>
    <nav class="tabs">${keys(TABS).map(k => `<button data-tab="${k}"${k === tab ? ' class="on"' : ''}>${TABS[k][0]}</button>`).join('')}</nav>
    ${atBase() ? '' : '<div class="away">Fora da base: só consulta. Comprar, vender, equipar e trocar de nave só na zona segura.</div>'}
    <main>${TABS[tab][1]()}</main></div>`;
  el.querySelector('main')!.scrollTop = y;
  const inv = el.querySelector('.inv'); if (inv) inv.scrollTop = iy;
  drawPreview();
}

// segundo clique rápido no mesmo lugar = duplo clique
function twice(key: string) {
  const t = performance.now(), dbl = lastClick.key === key && t - lastClick.t < 400;
  lastClick = {key: dbl ? '' : key, t};
  return dbl;
}
// ação sobre o item selecionado no Equipamento; como o item muda de lugar, a seleção deixa de valer
function act(what: string) {
  if (!sel) return;
  const ok = what === 'equip' ? equip(sel.i) : what === 'unequip' ? unequip(sel.i) : what === 'sell' && sellMod(sel.from, sel.i);
  if (!ok) return;
  if (what === 'sell') ui('sell');
  sel = null;
}
const buy = (k: ModKey) => { if (buyMod(k)) ui('buy'); };

// os data-* vêm dos botões gerados acima, então as chaves são sempre válidas
el.onclick = ev => {
  const b = (ev.target as Element).closest('button'), d = b?.dataset;
  if (!b || b.disabled || !d) return;
  if (d.close !== undefined) return toggleShop(false);
  if (d.account) return void accountAction(d.account);
  if (d.tab) tab = d.tab as Tab;
  else if (d.from) { // casa do Equipamento: um clique seleciona; duplo clique equipa ou desequipa
    const from = d.from as From, i = +d.i!;
    sel = {from, i}; oreSel = null;
    if (twice(from + i)) act(from === 'inv' ? 'equip' : 'unequip');
  }
  else if (d.ore) { oreSel = {ore: d.ore as OreKey, s: +d.s!, n: +d.n!}; sel = null; }
  else if (d.do === 'sellpack' || d.do === 'sellores') {
    if (oreSel && (d.do === 'sellpack' ? sellOre(oreSel.ore, oreSel.n) : sellCargo())) { ui('sell'); oreSel = null; }
  }
  else if (d.fold) { if (!folded.delete(d.fold)) folded.add(d.fold); }
  else if (d.do) act(d.do);
  else if (d.shipPick) shown = d.shipPick as ShipKey;
  else if (d.ship) { if (buyShip(d.ship as ShipKey)) ui('buy'); }
  else if (d.use) useShip(d.use as ShipKey);
  else if (d.cat) cat = d.cat as ModType;
  else if (d.item) { pick = d.item as ModKey; if (twice('item' + pick)) buy(pick); } // loja: duplo clique compra
  else if (d.buy) buy(d.buy as ModKey);
  else return;
  renderShop();
};

export const shopOpen = () => el.style.display === 'block';
onModelLoaded(() => { if (shopOpen()) renderShop(); }); // um ícone ficou pronto: mostra sem precisar reabrir
// a nave da prévia só gira enquanto o hangar está aberto
export const toggleShop = (on: boolean) => {
  el.style.display = on ? 'block' : 'none';
  cancelAnimationFrame(raf); raf = 0;
  if (on) { sel = null; oreSel = null; shown = save.ship; renderShop(); raf = requestAnimationFrame(spin); }
};

// botão ao lado da barra de atalhos: abre e fecha o inventário/hangar em qualquer lugar (o mesmo que a tecla B)
const bag = document.createElement('button');
bag.id = 'bag'; bag.title = 'Inventário e hangar (B)'; bag.tabIndex = -1; bag.innerHTML = svg(I.slots) + '<span>B</span>';
bag.addEventListener('mousedown', ev => ev.preventDefault()); // sem foco: senão o Espaço "clicaria" nele
bag.onclick = () => toggleShop(!shopOpen());
document.body.append(bag);
