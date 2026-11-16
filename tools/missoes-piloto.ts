// Ferramenta do administrador: refaz ou zera as missões de um piloto, direto na conta dele (Redis/Upstash). Os
// jogadores não têm esse botão; no jogo, "Refazer" só aparece rodando em localhost.
//
//   node --env-file=.env.local tools/missoes-piloto.ts <login> ver
//   node --env-file=.env.local tools/missoes-piloto.ts <login> refazer tutorial|operacoes|wuthering [--gravar]
//   node --env-file=.env.local tools/missoes-piloto.ts <login> zerar [--com-recompensas] [--gravar]
//
// refazer: a sequência volta à primeira missão; o que ele já tinha entregue não paga de novo (save.paid).
// zerar: apaga o progresso de todas as sequências, como num piloto novo; as recompensas já recebidas continuam sem pagar
//        de novo, a não ser com --com-recompensas.
// Sem --gravar, só mostra como ficaria. As credenciais do Redis vêm do .env.local (npx vercel env pull .env.local), que
// fica fora do git.
// Atenção: com o jogo aberto, o navegador do piloto grava o progresso dele por cima. Faça com ele fora do jogo; no
// próximo login ele recebe o progresso novo.
import { credentials, pilotId } from '../api/pilot.ts';
import { adopt, save } from '../src/game/state.ts';
import { restartTrack, journal } from '../src/game/missions.ts';
import type { Track } from '../src/game/missions.ts';

const [login = '', action = '', which = ''] = process.argv.slice(2), flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const TRACK: Record<string, Track> = {tutorial: 'main', operacoes: 'ops', wuthering: 'side'};
const c = credentials();
if (!c) throw new Error('Sem credenciais do Redis: rode com --env-file=.env.local (npx vercel env pull .env.local).');
const id = pilotId(login), key = `pilot:${id}`;
if (!id || !['ver', 'refazer', 'zerar'].includes(action) || action === 'refazer' && !TRACK[which])
  throw new Error('Uso: node --env-file=.env.local tools/missoes-piloto.ts <login> ver | refazer tutorial|operacoes|wuthering | zerar [--com-recompensas] [--gravar]');

const redis = async (command: string[]) => {
  const res = await fetch(c.url, {method: 'POST', headers: {authorization: `Bearer ${c.token}`}, body: JSON.stringify(command)});
  const body = await res.json() as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error ?? res.status}`);
  return body.result;
};
const raw = await redis(['GET', key]);
if (typeof raw !== 'string' || !adopt(JSON.parse(raw))) throw new Error(`Piloto "${id}" não encontrado (ou progresso ilegível).`);
const show = (title: string) => {
  console.log(title);
  for (const c of journal()) console.log(`  ${c.chain}: ${c.items.map(i => `${i.title} (${i.status})`).join(' → ') || '-'}`);
  console.log(`  recompensas já pagas: ${save.paid?.join(', ') || 'nenhuma'}`);
};
show(`Piloto ${id}, agora:`);
if (action === 'ver') process.exit(0);

if (action === 'refazer') restartTrack(TRACK[which]);
else {
  for (const t of Object.values(TRACK)) restartTrack(t); // anota em save.paid o que já foi entregue, antes de apagar
  delete save.quest; delete save.side; delete save.ops; delete save.tut; delete save.tutN;
  if (flags.has('--com-recompensas')) delete save.paid;
}
show('Depois:');
if (!flags.has('--gravar')) { console.log('\nNada gravado. Para aplicar, repita com --gravar (com o piloto fora do jogo).'); process.exit(0); }
await redis(['SET', key, JSON.stringify(save)]);
console.log('\nGravado. O piloto recebe o progresso novo no próximo login.');
