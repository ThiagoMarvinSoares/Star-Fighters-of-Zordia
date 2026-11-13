// Conta do piloto, no navegador: entrar, criar e manter o progresso no servidor (api/pilot.ts). O jogo continua
// salvando no navegador como sempre; com um piloto logado, cada salvamento também vai para o servidor, e ao entrar o
// progresso do servidor substitui o local. Sem servidor de contas (rodando com `npm run dev`, ou banco não
// configurado), nada disto aparece e o jogo segue só com o progresso local.
import { save, onPersist, adopt, forget } from '../game/state.ts';

const API = '/api/pilot';
/** escolheu "jogar sem conta" neste navegador: não pergunta de novo a cada visita (dá para entrar depois, pelo hangar) */
const GUEST = 'star-fighters-of-zordia:guest';
/** piloto logado, ou null; e se existe servidor de contas */
let pilot: string | null = null, available = false;

interface Reply { ok: boolean; message?: string; pilot?: string; save?: unknown }
// fala com o servidor; null se não veio JSON (sem servidor de contas: a rota devolve a página do jogo, ou a rede falhou)
async function call(method: string, body?: unknown, keepalive = false): Promise<{ status: number; data: Reply } | null> {
  try {
    const res = await fetch(API, {method, keepalive, headers: body ? {'content-type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
    if (!res.headers.get('content-type')?.includes('application/json')) return null;
    return {status: res.status, data: await res.json() as Reply};
  } catch { return null; }
}

// ---------- progresso no servidor ----------
// Como nas fichas do Grimoire: o envio sai 2 s depois do último salvamento, para uma sequência de mudanças virar um
// pedido só, e o que estiver pendente vai quando a página é fechada ou escondida.
let timer = 0, dirty = false;
function push(keepalive = false) {
  dirty = false; clearTimeout(timer);
  return call('PUT', {save}, keepalive).then(r => { if (!r) dirty = true; else if (r.status === 401) pilot = null; }); // 401: a sessão venceu
}
onPersist.push(() => { if (pilot) { dirty = true; clearTimeout(timer); timer = window.setTimeout(push, 2000); } });
addEventListener('pagehide', () => { if (pilot && dirty) push(true); });

// ---------- entrada ----------
/** Chamado na tela de carregamento, antes de o jogo abrir: retoma a sessão, ou mostra o formulário e espera a escolha. */
export async function enter(screen: HTMLElement | null) {
  const r = await call('GET');
  if (!r || r.status === 503) return; // sem servidor de contas: só o progresso local
  available = true;
  if (r.status === 200 && r.data.pilot) { pilot = r.data.pilot; if (r.data.save) adopt(r.data.save); return; }
  let guest = false;
  try { guest = !!localStorage.getItem(GUEST); } catch {}
  if (!guest && screen) await form(screen);
}
function form(screen: HTMLElement) {
  const f = document.createElement('form');
  f.id = 'pilot';
  f.innerHTML = `<h2>Piloto</h2>
    <input name="login" placeholder="Login" autocomplete="username" maxlength="24" required>
    <input name="code" type="password" placeholder="Código de acesso (8 ou mais caracteres)" autocomplete="current-password" maxlength="128" required>
    <button name="enter">Entrar</button><button type="button" name="create">Criar piloto</button>
    <button type="button" class="guest">Jogar sem conta</button>
    <p class="msg"></p>
    <small>Criar piloto guarda no servidor o progresso que está neste navegador. Entrar troca o progresso deste navegador pelo do piloto.</small>`;
  screen.append(f);
  const msg = f.querySelector('.msg')!, buttons = [...f.querySelectorAll('button')];
  return new Promise<void>(done => {
    const finish = () => { f.remove(); done(); };
    const send = async (action: 'login' | 'create') => {
      if (!f.reportValidity()) return;
      const d = new FormData(f);
      buttons.forEach(b => b.disabled = true); msg.textContent = '';
      const r = await call('POST', {action, login: d.get('login'), code: d.get('code'), ...(action === 'create' && {save})});
      buttons.forEach(b => b.disabled = false);
      if (!r) { msg.textContent = 'Não deu para falar com o servidor. Tente de novo.'; return; }
      if (!r.data.ok || !r.data.pilot) { msg.textContent = r.data.message ?? 'Não foi possível entrar.'; return; }
      pilot = r.data.pilot;
      if (action === 'login' && r.data.save) adopt(r.data.save);
      finish();
    };
    f.addEventListener('submit', ev => { ev.preventDefault(); void send('login'); });
    f.querySelector<HTMLButtonElement>('[name=create]')!.onclick = () => void send('create');
    f.querySelector<HTMLButtonElement>('.guest')!.onclick = () => { try { localStorage.setItem(GUEST, '1'); } catch {} finish(); };
  });
}

// ---------- no hangar ----------
/** bloco do cabeçalho do hangar: quem está logado e o botão de sair, ou o de entrar; vazio sem servidor de contas */
export const accountHtml = () => !available ? '' : pilot
  ? `<span class="acct">Piloto <b>${pilot}</b><button data-account="logout" title="Sair desta conta neste navegador">Sair</button></span>`
  : `<span class="acct">Sem conta<button data-account="login">Entrar ou criar piloto</button></span>`;
/** Sair: manda o que estiver pendente, encerra a sessão e apaga o progresso deste navegador (ele fica no servidor), para
 *  o próximo piloto criado aqui não herdar o progresso de outro. Entrar: recarrega a página, que mostra o formulário. */
export async function accountAction(what: string) {
  if (what === 'logout') { if (dirty) await push(); await call('DELETE'); forget(); }
  try { localStorage.removeItem(GUEST); } catch {}
  location.reload();
}
