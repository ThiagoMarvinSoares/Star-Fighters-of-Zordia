# Missões, conversas e personagens

Guia para criar histórias no Star Fighters of Zordia: missões, conversas e personagens novos. Escrito para quem for mexer no jogo depois, pessoa ou agente.

## Onde fica cada coisa

| Arquivo | O que tem |
|---|---|
| `src/game/missions.ts` | a lista `MISSIONS` (o conteúdo), os nomes dos personagens (`NAMES`) e o motor que faz tudo funcionar |
| `src/ui/missions.ts` | o painel de conversa, o painel de objetivo, o botão "?" e os retratos (`FACES`) |
| `public/characters/*.jpg` | as fotos dos personagens |
| `src/view/render.ts` | o "!" sobre a estação e a lista de retratos carregados na tela de carregamento (`preloadImages`) |
| `test.ts` | o bloco "missões" percorre a sequência inteira pelo motor |

Regra geral: **conteúdo e regras ficam em `src/game/`, tela fica em `src/ui/`.** O motor não sabe nada de HTML; a tela não decide nada sobre progresso.

## Como uma missão anda

1. **`offer`:** a conversa de início está esperando. A estação ganha um "!" amarelo e clicar nela (com a nave dentro da base) abre a conversa em vez do hangar.
2. **`active`:** a conversa terminou, os presentes (`gift`) foram entregues e o objetivo aparece no painel, abaixo do painel do jogador, com a contagem.
3. **`ready`:** o objetivo foi cumprido. O "!" volta à estação.
4. **Entrega:** a conversa de entrega (`end`) toca, o piloto entrega o que a missão pede (`take`), recebe a recompensa (`reward`) e, se houver `next`, a conversa de início da próxima missão já vem emendada na mesma conversa.
5. **`done`:** acabou a sequência. Não há "!" nem objetivo.

A missão atual fica em `save.quest = {id, stage, n}` e vai junto com o progresso do piloto (navegador e servidor). `n` é quanto do objetivo já foi feito.

## Criar uma missão

Acrescente um bloco em `MISSIONS`, em `src/game/missions.ts`, e aponte o `next` da missão anterior para o `id` dela. Nada mais precisa mudar.

```ts
{
  id: 'raiders', giver: 'fabricio',
  start: [
    'Os Raiders voltaram a rondar as rotas de mineração. Preciso de números, não de boatos.',
    'Derrube cinco e traga os registros de combate.',
  ],
  goal: {kill: 'raider', count: 5},
  text: 'Destrua 5 Raiders', hint: 'Eles ficam além dos Drones',
  end: ['Cinco. Os registros confirmam o padrão de ataque. Bom trabalho.'],
  reward: {credits: 1500},
},
```

### Campos

| Campo | Obrigatório | Para quê |
|---|---|---|
| `id` | sim | identificador único, em minúsculas com hífen; fica salvo no progresso dos jogadores, então **não renomeie** uma missão que já foi publicada |
| `giver` | sim | quem passa a missão: fala as linhas sem dono e assina o objetivo no painel |
| `start` | sim | conversa de início |
| `goal` | sim | o objetivo (tipos abaixo) |
| `text` | sim | o objetivo no painel; a contagem `(n/count)` é acrescentada sozinha quando `count > 1` |
| `hint` | sim | a dica de controle, embaixo do objetivo (aqui sim pode falar de teclas e cliques) |
| `end` | sim | conversa de entrega |
| `shop` | não | `true` abre o hangar quando a conversa de início termina |
| `gift` | não | itens entregues ao começar, para a missão ser possível; não dá um item de um tipo que o piloto já tenha |
| `take` | não | minério que o piloto entrega no fim, por exemplo `{purple: 20}`; tira até o que houver no porão |
| `reward` | não | `{credits: 300}` e/ou `{items: ['C1']}` |
| `next` | não | `id` da missão seguinte; sem ele, a sequência termina |

### Tipos de objetivo

| Objetivo | Conta quando |
|---|---|
| `{kill: 'drone', count: 3}` | um inimigo com essa `key` de modelo é destruído. `'drone'` vale para Drone e Drone Alfa; `'raider'` para Raider e Raider Elite; `'dreadnought'` para os dois Dreadnoughts; `'boss'` para o Leviatã |
| `{mine: 'purple', count: 20}` | o feixe extrai esse minério (`purple` = Ametista, `cyan` = Turquesa, `blue` = Safira); conta frações |
| `{buy: 'laser', count: 1}` | um módulo desse tipo é comprado no hangar (`laser`, `shield`, `engine`, `aim`, `missile`, `mining`, `chip`) |

### Falas com mais de um personagem

Uma fala sem dono é dita por quem passa a missão (`giver`). Para outro personagem falar, use `[quem, texto]`:

```ts
start: [
  'Fala do giver.',
  ['huedro', 'Fala do Comandante no meio da conversa.'],
],
```

O painel troca de retrato, nome e função a cada fala. Foi assim que o Huedro passou a palavra ao Fabrício.

### Sequência atual

| `id` | Quem passa | Objetivo | Entrega e recompensa |
|---|---|---|---|
| `boas-vindas` | Huedro | destruir 3 Drones | — |
| `primeiro-laser` | Huedro | comprar um laser (abre o hangar) | o Huedro apresenta o Fabrício |
| `amostras` | Fabrício | extrair 20 de Ametista (recebe o Minerador Mk1 ao começar) | entrega as 20 Ametistas, recebe 300 cr; fim da sequência |

## Criar um tipo de objetivo

1. Acrescente a forma nova em `Goal` e em `QuestEvent`, em `src/game/missions.ts`.
2. Acrescente a regra de contagem em `progress()`.
3. Chame `progress({...})` no lugar do jogo onde aquilo acontece (a simulação em `src/game/sim.ts`, ou um aviso como `onBought` em `src/game/state.ts`).
4. Cubra no bloco "missões" do `test.ts`.

Depois disso o tipo fica disponível para qualquer missão.

## Criar um personagem

1. **Foto:** quadrada ou em pé, fundo escuro, de 540 a 600 px no lado maior, em JPEG (as originais de 1,5 MB viram uns 90 KB). Nesta máquina não há ferramenta de imagem no Linux; a conversão foi feita com o `System.Drawing` do Windows pelo `powershell.exe`, salvando primeiro numa pasta temporária do Windows e copiando depois para `public/characters/<nome>.jpg`.
2. **Nome:** em `NAMES`, `src/game/missions.ts`.
3. **Retrato e função:** em `FACES`, `src/ui/missions.ts`. `w` é a largura em que a foto é mostrada, e `x`/`y` deslocam a foto para o rosto e os ombros caberem no quadro de 120×140. Para acertar o recorte: com a largura `w`, o centro do rosto deve ficar a 60 px da borda esquerda do quadro.
4. **Carregamento:** acrescente o nome na lista de retratos em `preloadImages`, em `src/view/render.ts`, e some 1 em `IMAGES`, para a foto chegar na tela de carregamento.

## Como escrever as falas

- **Português correto, sem ser formal.** Nada de "tô", "pra", "né", "tá"; prefira "estou", "para", "não é?", "está". Expressões com personalidade são bem-vindas ("Ora, ora...", "a coisa fica feia").
- **De dentro do jogo.** As falas não citam teclas, cliques, botões, mapa, interface ou "círculo verde". O personagem fala da base, do setor, da estação, do hangar. **O que o jogador precisa apertar vai no `hint`**, que aparece no painel de objetivo.
- **Curtas.** Uma ou duas frases por fala; o painel tem espaço para umas três linhas.
- **Cada personagem com a sua voz** (abaixo).

## Personagens

### Comandante Augusto (Huedro)

- **Nome:** Pedro Augusto. Para os pilotos, Comandante Augusto. Os mais próximos o chamam de Huedro.
- **Cargo:** comandante da Base Outer Space, da Aliança de Zordia.
- **Voz:** amigável, bem-humorado, acolhedor com os pilotos novos. Brinca que "gente nova aparece na minha base toda semana". Quem dá as boas-vindas e o primeiro serviço.

### Fabrício

- **Cargo:** Supervisor de Operações da Base Outer Space. Patente: Oficial de Frota. Organização: Aliança de Zordia. Superior direto: o Comandante Huedro.
- **Especialidade:** pesquisa, análise e coordenação operacional.
- **Personalidade:** extremamente cético e questionador; analítico, observador e racional; não acredita em teorias sem evidências; exigente com os pilotos e com a equipe técnica; prefere dados e resultados a explicações; questiona até as decisões do próprio comandante.
- **Voz:** seco, preciso, cobra números ("Nem dezenove, nem estimativa. Vinte."), chama o Huedro de "Comandante" e implica com a falta de dados nas ordens dele. Pede as coisas com motivo (amostras para análise, registros de combate) e paga o "preço justo", não por generosidade.
- **Papel:** depois do tutorial, é quem passa as missões.

## Lore já estabelecida

- O jogo se passa no setor **Outer Space**, ao redor da **Base Outer Space**, uma estação em anel da **Aliança de Zordia**.
- Na área da base o piloto está seguro e o casco é consertado; quem chega ainda em combate não tem proteção.
- **Drones:** criaturas orgânicas que só atacam quem mexe com elas; ficam perto da base.
- Quanto mais longe da base, mais perigoso: Raiders, depois Dreadnoughts, e no canto mais distante o **Leviatã**, uma criatura orgânica colossal que guarda um chip.
- **Ametista** é o minério comum; **Turquesa** e **Safira** são mais duras, valem mais e ficam em áreas mais perigosas. Nenhuma das amostras de Ametista mostrou contaminação orgânica.

## Antes de publicar

- `npm test` precisa passar. O bloco "missões" confere que todo `next` aponta para uma missão que existe; acrescente nele a missão nova se ela tiver regra diferente.
- **Não renomeie nem remova** missões publicadas: o `id` está no progresso dos jogadores. Se uma missão sumir do código, quem estava nela tem a sequência dada como terminada.
- O botão "?" recomeça a sequência do início, bom para testar as conversas.
- Neste projeto, **commit e push só com aprovação**: o push no `main` publica na Vercel na hora.
