# Star Fighters of Zordia

Jogo de naves para navegador em TypeScript, Vite e three.js, com contas de piloto numa função da Vercel (`api/pilot.ts`) e Redis.

- `src/game/`: regras e dados, sem nada de navegador (é o que um servidor rodaria no multiplayer). Balanceamento em `data.ts`.
- `src/view/`: desenho e som. `src/ui/`: telas e controles.
- `npm test` roda `test.ts` com sorteios fixos; para variar, `SEED=7 node test.ts`. `npm run build` gera o site.
- Commit e push só com aprovação do usuário: o push no `main` publica na Vercel.

**Missões, conversas e personagens:** antes de criar ou mudar uma história, leia [`docs/LORE.md`](docs/LORE.md) (a lore completa do autor: Zordia, a Aliança, o Silêncio das Rotas, os mistérios que não se resolvem) e [`docs/MISSOES.md`](docs/MISSOES.md) (o formato das missões, como criar personagens e objetivos, o tom das falas).
