// Conta do piloto: login + código de acesso, com o progresso do jogo guardado no Redis. Mesmo esquema das fichas do
// Grimoire: do código só se guarda um hash scrypt com sal, a sessão é um cookie assinado (HMAC) pelo servidor, e as
// tentativas são limitadas por janela de tempo. É uma função da Vercel (rota /api/pilot) num arquivo só, sem
// dependências: fala com o Redis (Upstash) pela API REST dele.
//
//   GET    /api/pilot                              -> o progresso do piloto da sessão
//   POST   /api/pilot {action: 'create', login, code, save}  -> cria o piloto (o progresso atual vai junto) e abre a sessão
//   POST   /api/pilot {action: 'login', login, code}         -> abre a sessão e devolve o progresso
//   PUT    /api/pilot {save}                       -> grava o progresso do piloto da sessão
//   DELETE /api/pilot                              -> encerra a sessão
//
// Variáveis de ambiente: SESSION_SECRET (32+ caracteres; sem ela ninguém entra) e as do Redis, que a Vercel injeta ao
// conectar um banco em Storage (KV_REST_API_URL / KV_REST_API_TOKEN).
//
// O progresso é guardado como o navegador mandou: o servidor só confere tamanho e formato JSON. Quem valida o conteúdo
// é o jogo, ao carregar (parseSave). Enquanto a simulação rodar no navegador, o jogador consegue adulterar o próprio
// progresso; isso muda quando houver servidor de jogo (multiplayer).
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const COOKIE = 'pilot_access';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias
const MIN_CODE = 8, MAX_CODE = 128, MIN_LOGIN = 3, MAX_LOGIN = 24, MAX_SAVE = 16_000;
/** espera fixa em cada tentativa de login: encarece tentar em massa */
const VERIFY_DELAY_MS = 450;
/** limites por janela: 5 tentativas por piloto e IP, 20 por IP em qualquer piloto; 3 pilotos criados por hora por IP */
const WINDOW = 15 * 60, PER_PILOT = 5, PER_IP = 20, CREATES_PER_HOUR = 3;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...headers}});
const fail = (message: string, status = 400, headers?: Record<string, string>) => json({ok: false, message}, status, headers);

// ---------- Redis (Upstash, API REST) ----------
// Acha as credenciais pelo sufixo do nome, porque cada integração batiza as variáveis de um jeito (algumas com o nome
// do banco na frente). O nome mais curto ganha: o sem prefixo primeiro.
function credentials(env = process.env) {
  const suffix = /(KV_REST_API_URL|UPSTASH_REDIS_REST_URL|REDIS_REST_URL)$/;
  for (const key of Object.keys(env).filter(k => suffix.test(k)).sort((a, b) => a.length - b.length)) {
    const url = env[key], token = env[key.replace(/URL$/, 'TOKEN')];
    if (url && token) return {url, token};
  }
  return null;
}
/** roda os comandos numa transação só (MULTI/EXEC) e devolve o resultado de cada um */
async function redis(...commands: (string | number)[][]): Promise<unknown[]> {
  const c = credentials();
  if (!c) throw new Error('Redis não configurado');
  const res = await fetch(`${c.url}/multi-exec`, {method: 'POST', headers: {authorization: `Bearer ${c.token}`}, body: JSON.stringify(commands)});
  if (!res.ok) throw new Error(`Redis respondeu ${res.status}`);
  return ((await res.json()) as { result?: unknown; error?: string }[]).map(r => { if (r.error) throw new Error(r.error); return r.result; });
}
/** conta uma tentativa na janela. INCR e EXPIRE vão juntos: separados, uma falha no meio deixaria a chave sem prazo */
const countAttempt = async (bucket: string, seconds: number) => (await redis(['INCR', `ratelimit:${bucket}`], ['EXPIRE', `ratelimit:${bucket}`, seconds, 'NX']))[0] as number;
/** IP de quem pede. Na Vercel o primeiro item de x-forwarded-for é o cliente (a plataforma reescreve o cabeçalho). */
const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

// ---------- código de acesso e sessão ----------
/** login -> id do piloto: minúsculas, sem acento, só a-z, 0-9 e hífen */
export const pilotId = (login: string) => login.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_LOGIN);
const derive = promisify(scrypt) as (code: string, salt: string, length: number) => Promise<Buffer>;
/** código -> `sal:hash`, que é o que vai para o banco. Nunca o código. */
async function hashCode(code: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(code, salt, 32)).toString('hex')}`;
}
async function matchesHash(stored: string, code: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(await derive(code, salt, expected.length), expected);
}
/** comparação em tempo constante: não revela quanto bateu */
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
/** Assina a sessão com uma chave que só o servidor tem. O hash do código entra na assinatura: trocar o código derruba
 *  as sessões abertas. Sem SESSION_SECRET ninguém entra, o que é melhor do que assinar com chave previsível. */
function sign(id: string, issuedAt: number, codeHash: string) {
  const key = process.env.SESSION_SECRET ?? '';
  return key.length >= 32 ? createHmac('sha256', key).update(`${id}.${issuedAt}.${codeHash}`).digest('hex') : null;
}
const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
function grant(id: string, codeHash: string) {
  const issuedAt = Math.floor(Date.now() / 1000), signature = sign(id, issuedAt, codeHash);
  if (!signature) throw new Error('SESSION_SECRET ausente ou curta demais: use 32+ caracteres.');
  return {'set-cookie': cookie(`${id}.${issuedAt}.${signature}`, SESSION_MAX_AGE)};
}
/** o piloto desta sessão, ou null */
async function sessionPilot(request: Request) {
  const raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? '';
  const [id, issued, signature] = raw.split('.'), issuedAt = Number(issued);
  if (!id || !signature || !Number.isInteger(issuedAt)) return null;
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  if (age < 0 || age > SESSION_MAX_AGE) return null;
  const [codeHash] = await redis(['GET', `pilot:${id}:code`]);
  if (typeof codeHash !== 'string') return null;
  const expected = sign(id, issuedAt, codeHash);
  return expected && safeEqual(signature, expected) ? id : null;
}

// ---------- rotas ----------
/** embrulha uma rota: banco ou segredo faltando vira 503 com explicação, em vez de erro genérico */
const route = (run: (request: Request) => Promise<Response>) => async (request: Request) => {
  if (!credentials() || (process.env.SESSION_SECRET ?? '').length < 32) return fail('Contas indisponíveis: o servidor ainda não foi configurado.', 503);
  try { return await run(request); }
  catch (e) { console.error('api/pilot:', e); return fail('Não deu para falar com o servidor agora. Tente de novo em instantes.', 503); }
};
const body = async (request: Request) => { try { const b = await request.json(); return b && typeof b === 'object' ? b as Record<string, unknown> : null; } catch { return null; } };
/** o progresso como texto JSON, se for um objeto e couber no limite */
function saveText(save: unknown) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  const text = JSON.stringify(save);
  return text.length <= MAX_SAVE ? text : null;
}
const parse = (text: unknown) => { try { return typeof text === 'string' ? JSON.parse(text) : null; } catch { return null; } };

export const GET = route(async request => {
  const id = await sessionPilot(request);
  if (!id) return fail('Sem sessão.', 401);
  return json({ok: true, pilot: id, save: parse((await redis(['GET', `pilot:${id}`]))[0])});
});

export const POST = route(async request => {
  const b = await body(request);
  if (!b) return fail('Pedido malformado.');
  const id = pilotId(typeof b.login === 'string' ? b.login : ''), code = typeof b.code === 'string' ? b.code : '', ip = clientIp(request);

  if (b.action === 'create') {
    if (id.length < MIN_LOGIN) return fail(`O login precisa de pelo menos ${MIN_LOGIN} letras ou números.`);
    if (code.length < MIN_CODE || code.length > MAX_CODE) return fail(`O código de acesso precisa de pelo menos ${MIN_CODE} caracteres.`);
    const text = saveText(b.save);
    if (!text) return fail('Progresso inválido.');
    if ((await countAttempt(`create:${ip}`, 60 * 60)) > CREATES_PER_HOUR) return fail('Muitos pilotos criados daqui. Tente de novo em uma hora.', 429, {'retry-after': '3600'});
    const codeHash = await hashCode(code);
    // NX: só grava se o login estiver livre; é o que impede dois pilotos de pegarem o mesmo ao mesmo tempo
    const [claimed] = await redis(['SET', `pilot:${id}:code`, codeHash, 'NX']);
    if (claimed !== 'OK') return fail(`O login "${id}" já está em uso. Escolha outro.`, 409);
    await redis(['SET', `pilot:${id}`, text]);
    return json({ok: true, pilot: id}, 201, grant(id, codeHash));
  }

  if (b.action === 'login') {
    const [pilotTries, ipTries] = await Promise.all([countAttempt(`login:${ip}:${id}`, WINDOW), countAttempt(`login:${ip}`, WINDOW)]);
    if (pilotTries > PER_PILOT || ipTries > PER_IP) return fail('Muitas tentativas. Espere 15 minutos e tente de novo.', 429, {'retry-after': String(WINDOW)});
    await new Promise(ok => setTimeout(ok, VERIFY_DELAY_MS));
    const [codeHash, save] = id ? await redis(['GET', `pilot:${id}:code`], ['GET', `pilot:${id}`]) : [null, null];
    // mesma resposta para login desconhecido e código errado: não revela quais pilotos existem
    if (typeof codeHash !== 'string' || !(await matchesHash(codeHash, code))) return fail('Login ou código de acesso errado.', 401);
    return json({ok: true, pilot: id, save: parse(save)}, 200, grant(id, codeHash));
  }
  return fail('Ação desconhecida.');
});

export const PUT = route(async request => {
  const id = await sessionPilot(request);
  if (!id) return fail('Sem sessão.', 401);
  const text = saveText((await body(request))?.save);
  if (!text) return fail('Progresso inválido.');
  await redis(['SET', `pilot:${id}`, text]);
  return json({ok: true});
});

export const DELETE = async () => json({ok: true}, 200, {'set-cookie': cookie('', 0)});
