# Missões, conversas e personagens

Guia para criar histórias no Star Fighters of Zordia: missões, conversas e personagens novos. Escrito para quem for mexer no jogo depois, pessoa ou agente.

## Onde fica cada coisa

| Arquivo | O que tem |
|---|---|
| `src/game/missions.ts` | a lista `MISSIONS` (o conteúdo), os nomes dos personagens (`NAMES`) e o motor que faz tudo funcionar |
| `src/ui/missions.ts` | o painel de conversa, o painel de objetivo, o menu de missões e os retratos (`FACES`) |
| `public/characters/*.jpg` | as fotos dos personagens |
| `src/view/render.ts` | o "!" sobre a estação, o cenário das missões, o marcador de alvo (anel, minimapa e seta) e a lista de retratos carregados na tela de carregamento (`preloadImages`) |
| `test.ts` | o bloco "missões" percorre a sequência inteira pelo motor |

Regra geral: **conteúdo e regras ficam em `src/game/`, tela fica em `src/ui/`.** O motor não sabe nada de HTML; a tela não decide nada sobre progresso.

## Como uma missão anda

1. **`offer`:** a conversa de início está esperando. A estação ganha um "!" amarelo e clicar nela (com a nave dentro da base) abre a conversa em vez do hangar.
2. **`active`:** a conversa terminou, os presentes (`gift`) foram entregues e o objetivo aparece no painel, abaixo do painel do jogador, com a contagem.
3. **`ready`:** o objetivo foi cumprido. O "!" volta à estação.
4. **Entrega:** a conversa de entrega (`end`) toca, o piloto entrega o que a missão pede (`take`), recebe a recompensa (`reward`) e, se houver `next`, a conversa de início da próxima missão já vem emendada na mesma conversa.
5. **`done`:** acabou a sequência. Não há "!" nem objetivo.

Com `report: 'field'`, a entrega não espera a base: a conversa abre sozinha, onde o piloto estiver, assim que o objetivo é cumprido. É o que permite uma história andar no meio do espaço.

### Duas sequências

- **Principal** (`save.quest`): começa pelo tutorial.
- **Secundária** (`save.side`): existe desde o começo do jogo e começa por descoberta, quando o piloto acha a nave de Elyra nas Rotas Silenciosas. Ninguém manda o piloto lá. A primeira missão dela é `FIRST.side`, em `src/game/missions.ts`.

Cada sequência tem um nome no menu de missões, em `CHAINS`. As duas andam ao mesmo tempo e são salvas separadas. Na base, a principal tem a vez para conversar, e o painel mostra o objetivo da principal enquanto ela existir. Cada sequência tem uma missão por vez; para outra cadeia paralela, o motor precisaria de mais uma trilha em `Track`.

`save.quest` e `save.side` têm o formato `{id, stage, n}` e vão junto com o progresso do piloto (navegador e servidor). `n` é quanto do objetivo já foi feito.

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
| `title` | sim | o nome da missão no menu de missões |
| `giver` | sim | quem passa a missão: fala as linhas sem dono e assina o objetivo no painel |
| `start` | sim | conversa de início |
| `goal` | sim | o objetivo (tipos abaixo) |
| `text` | sim | o objetivo no painel; a contagem `(n/count)` é acrescentada sozinha quando `count > 1` |
| `hint` | sim | a dica de controle, embaixo do objetivo (aqui sim pode falar de teclas e cliques) |
| `end` | sim | conversa de entrega |
| `shop` | não | `true` abre o hangar quando a conversa de início termina |
| `find` | não | `true`: o lugar ainda não foi visto, então não há marcador (anel, losango, seta). O piloto acha pelas coordenadas que um personagem passa na conversa e pelas da nave, acima do minimapa. Regra da casa: achar coisas novas é sem marcador; voltar à base e voltar a lugares já achados tem marcador |
| `hidden` | não | `true`: objetivo secreto. Sem painel, marcador nem menu até ser cumprido. Com `start: []`, a missão já nasce em andamento; é como uma história começa por descoberta. Continua escondida mesmo refeita: precisa ser achada de novo |
| `report` | não | `'field'`: a conversa de entrega abre na hora, onde o piloto estiver |
| `ask` | não | uma escolha no fim da entrega: `{yes, no, then}`. Com o "sim", tocam as falas `then` (com a conversa de início da próxima missão emendada) e a missão termina; com o "não", a conversa fecha e a missão volta a ativa (num objetivo de lugar, o piloto precisa sair e voltar para a pergunta reaparecer) |
| `radio` | não | falas soltas que chegam de vez em quando enquanto o objetivo está ativo, como legenda no topo da tela, com chiado |
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
| `{reach: 'nave-elyra'}` | a nave entra no raio de um lugar de `PLACES` (conta ao entrar, de fora para dentro). O lugar ganha um anel no chão, um losango no minimapa e uma seta na borda da tela com a distância. Se o lugar fica noutro mapa, o marcador aponta o portal que leva até lá |

Os lugares ficam em `PLACES`, em `src/game/missions.ts`: `{map, x, y, r}`. O minimapa tem uma grade de coordenadas (X para a direita, Y para baixo, a partir do canto superior esquerdo) e mostra, acima dele, a posição da nave e as coordenadas do lugar do objetivo ativo. Para um personagem falar ou a dica mostrar as coordenadas de um lugar, use `coords('id')` ("Rotas Silenciosas · X 7200 · Y 1950") ou `PLACES[id].x` e `.y` numa fala com crase. Os mapas ficam em `MAPS`, em `src/game/data.ts`:

| Mapa | Tamanho | O que tem |
|---|---|---|
| `outer` (Outer Space) | 9000 × 6000 | a base em (600, 600); os inimigos ficam mais fortes com a distância dela: Drones e Drones Alfa perto, Raiders e Raiders Elite no fundo; minério: Ametista e Turquesa; a nave de Elyra no canto inferior direito, com dois Raiders Elite de guarda (`guards`, em `data.ts`: mudou a nave de lugar, mude os guardas); portal para as Rotas Silenciosas no canto inferior esquerdo (600, 5400) |
| `silent` (Rotas Silenciosas) | 9000 × 6000 | o fim de jogo, sem base. Mesmo padrão a partir da chegada (700, 700): Drones Elite (passivos) perto, Dreadnoughts no meio (a partir de uns 3.200), Dreadnoughts Prime no fundo (a partir de uns 6.500) e o Leviatã no canto oposto (8200, 5300); minério: Turquesa e Safira. Fundo escuro; portal de volta em (420, 420). É onde fica Wuthering Heights |

Para um mapa novo: a chave em `MapKey`, a descrição em `MAPS` e um portal de cada lado (o teste confere que cada portal leva para dentro do mapa de destino, longe dos portais de lá). O fundo vai em `public/bg/` e é carregado na tela de carregamento.

### Falas com mais de um personagem

Uma fala sem dono é dita por quem passa a missão (`giver`). Para outro personagem falar, use `[quem, texto]`:

```ts
start: [
  'Fala do giver.',
  ['huedro', 'Fala do Comandante no meio da conversa.'],
],
```

O painel troca de retrato, nome e função a cada fala. Foi assim que o Huedro passou a palavra ao Fabrício.

Um terceiro valor segura a fala na tela por alguns segundos antes de liberar o botão: `['elyra', 'Abra a porta.', 2]`. **Com texto vazio, é um silêncio**: o painel fica só com a moldura e avança sozinho depois dos segundos, como em `['sistema', '', 4]`.

### Sequência atual

| `id` | Quem passa | Objetivo | Entrega e recompensa |
|---|---|---|---|
| `boas-vindas` | Huedro | destruir 3 Drones | — |
| `primeiro-laser` | Huedro | comprar um laser (abre o hangar) | o Huedro apresenta o Fabrício |
| `amostras` | Fabrício | extrair 20 de Ametista (recebe o Minerador Mk1 ao começar) | entrega as 20 Ametistas, recebe 300 cr; fim da sequência |

### Sequência secundária: Wuthering Heights

História gótica e melancólica, inspirada em *O Morro dos Ventos Uivantes*: Elyra, exploradora, morreu à deriva quando a nave despressurizou; Heathcliff, o companheiro, morreu na estação esperando por ela. Ela ainda tenta voltar e não sabe que os dois morreram. Nenhum dos dois aparece: tudo é contado por registros, transmissões, sensores e a porta da estação. **O fim não explica nada**: a porta abre, a transmissão para e a nave some. Depois, o Comandante e o Fabrício tentam entender: o Huedro pela lembrança (ele era cadete quando as buscas foram canceladas), o Fabrício pelos dados, com hipóteses que não fecham. **O farol é o centro:** Heathcliff o via aceso, Elyra nunca viu a luz; estavam perto um do outro, em realidades diferentes. A última leitura mostra o farol aceso numa estação sem energia, e o caso é arquivado sem conclusão. Não confirme se abrir a porta deixou Elyra entrar. Ninguém confirma o que aconteceu.

| `id` | Objetivo | O que acontece |
|---|---|---|
| `o-sinal-perdido` | achar a nave de Elyra, à deriva no canto mais afastado de Outer Space (8300, 5400), com dois Raiders Elite de guarda; escondida (`hidden`), sem conversa de início | ao chegar perto: o Fabrício capta o transponder, o Huedro se lembra do caso; os registros de Elyra e o transmissor que continua ativo sem energia |
| `a-estacao` | chegar à estação abandonada, nas Rotas Silenciosas (7200, 1950); o Fabrício acha as coordenadas nos registros e as passa ao piloto | transmissões soltas de Elyra no caminho; no local, Heathcliff morto e a última gravação ("Se ela voltar, não deixem a porta fechada."); na fala do ALERTA (`cue`), a nave de Elyra entra nas Rotas Silenciosas pelo portal, sozinha, e vem até o lado da estação, à vista do piloto |
| `o-ultimo-retorno` | chegar ao sistema central, na doca (7200, 2180) | a escolha muda o caminho, não o fim (`ask.otherwise`). Liberada: "ACESSO CONCEDIDO" e a transmissão para no mesmo segundo. Mantida fechada: Elyra ainda fala alguns segundos e a transmissão se apaga sozinha. Nas duas, a nave de Elyra some no silêncio (`cue`); 2.000 cr |
| `depois-do-silencio` | voltar à base (lugar `base`, em Outer Space) | na sala do Comandante, ele e o Fabrício repassam os fatos: o eco gravado é a hipótese do Fabrício, a nave que se moveu sozinha fica sem resposta. O farol: Heathcliff o via aceso, Elyra nunca viu a luz; "ou os dois disseram a verdade". Ninguém sabe se ela chegou a entrar |
| `o-farol` | voltar à estação abandonada | leitura do farol: geradores frios e "FAROL: ATIVO"; o Comandante: "Talvez agora ela consiga ver."; o Fabrício arquiva o caso ("A tripulante retornou à estação.") e admite que os dados não precisam explicar tudo; 1.000 cr; fim da sequência |

O cenário dessa história (a nave de Elyra e a estação) é montado por `scenery()`, em `src/game/missions.ts`, conforme a missão em que o piloto está: a nave à deriva está lá desde o começo do jogo (é achá-la que abre a história), vem até o lado da estação no fim da segunda e some no silêncio depois de a porta ser liberada; a estação fica no mapa, em silêncio, depois de encontrada.

## Criar um tipo de objetivo

1. Acrescente a forma nova em `Goal` e em `QuestEvent`, em `src/game/missions.ts`.
2. Acrescente a regra de contagem em `progress()`.
3. Chame `progress({...})` no lugar do jogo onde aquilo acontece (a simulação em `src/game/sim.ts`, ou um aviso como `onBought` em `src/game/state.ts`).
4. Cubra no bloco "missões" do `test.ts`.

Depois disso o tipo fica disponível para qualquer missão.

## Menu de missões

A tecla J, ou o botão à direita do inventário, abre o menu de missões (`src/ui/missions.ts`, dados de `journal()` em `src/game/missions.ts`). Ele lista cada sequência já liberada com as missões concluídas e a atual, com a fase dela: disponível (falar na base), em andamento (com a contagem), pronta para entregar. **Missões futuras não aparecem**, para não estragar a história.

"Acompanhar" uma sequência põe o objetivo dela na vez do painel e do marcador do mapa (`pin.track`). Isso não é salvo: ao recarregar, a principal volta a ter a vez.

O nome de cada sequência abre e fecha a lista das missões dela. Ao lado do nome, um botão ("Refazer" na sequência concluída, "Recomeçar" na que está em andamento) volta a sequência à primeira missão (`replay()`), abre a conversa de início na hora, onde o piloto estiver, e a história segue dali como da primeira vez. **A recompensa só é paga uma vez:** ao voltar, as missões já entregues da sequência entram em `save.paid`, e a entrega de uma missão que está lá não cobra minério (`take`) nem paga (`reward`). Os presentes (`gift`) já não se repetem se o piloto tiver um item do mesmo tipo.

## Cenário de missão

Objetos que existem no mapa por causa de uma missão ficam em `scenery()`: cada um é `{id, x, y, r, model, label, spin, a}`, com `model` sendo um arquivo da biblioteca (`ships/scout`, `bases/base_anel`...). A função decide, pelo progresso salvo, o que aparece e onde. Para algo se mexer no meio de uma conversa, marque em `cue` o índice da fala de `end` que dispara o movimento (a tela chama `cue()` ao mostrá-la) e calcule a posição em `scenery()` a partir dessa hora. Eles são só visuais: não colidem nem atiram.

## Criar um personagem

1. **Foto:** quadrada ou em pé, fundo escuro, de 540 a 600 px no lado maior, em JPEG (as originais de 1,5 MB viram uns 90 KB). Nesta máquina não há ferramenta de imagem no Linux; a conversão foi feita com o `System.Drawing` do Windows pelo `powershell.exe`, salvando primeiro numa pasta temporária do Windows e copiando depois para `public/characters/<nome>.jpg`.
2. **Nome:** em `NAMES`, `src/game/missions.ts`.
3. **Retrato e função:** em `FACES`, `src/ui/missions.ts`. `w` é a largura em que a foto é mostrada, e `x`/`y` deslocam a foto para o rosto e os ombros caberem no quadro de 120×140. Para acertar o recorte: com a largura `w`, o centro do rosto deve ficar a 60 px da borda esquerda do quadro.
4. **Carregamento:** acrescente o nome na lista de retratos em `preloadImages`, em `src/view/render.ts`, e some 1 em `IMAGES`, para a foto chegar na tela de carregamento.

**Personagem sem rosto** (transmissão, gravação, terminal): em `FACES`, em vez de foto, `signal: 'SINAL'`. O quadro mostra estática correndo com esse rótulo, e a fala vem com chiado de rádio. É como falam Elyra (`elyra` ao vivo, `elyra-log` nos registros), Heathcliff (`heathcliff`), o computador da nave (`bordo`) e o da estação (`sistema`).

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
- **Papel:** depois do tutorial, é quem passa as missões. Diante do inexplicável, procura a explicação racional e admite quando não tem uma ("Não sei. Ainda.").

### Elyra

- Exploradora e piloto da Aliança de Zordia. Morreu à deriva depois de uma falha de pressurização, tentando voltar para a estação.
- **Só fala por registro de bordo e por transmissão.** Não sabe que morreu. Fala com Heathcliff como se ele ainda esperasse. Frases curtas, íntimas, com pausas e reticências.

### Heathcliff

- Responsável pela manutenção e pelas operações de uma estação orbital antiga. Companheiro de Elyra. Morreu na estação, anos depois, esperando por ela; nunca pediu evacuação.
- **Só fala por gravação.** Cansado, constante, sem drama. A última vontade: "Se ela voltar, não deixem a porta fechada."

### Os sistemas

- `bordo` e `sistema` falam em MAIÚSCULAS, como terminal: estado de compartimentos, alertas, acessos.

## Lore já estabelecida

- O jogo se passa no setor **Outer Space**, ao redor da **Base Outer Space**, uma estação em anel da **Aliança de Zordia**.
- Na área da base o piloto está seguro e o casco é consertado; quem chega ainda em combate não tem proteção.
- **Drones:** criaturas orgânicas que só atacam quem mexe com elas; ficam perto da base.
- Quanto mais longe da base, mais perigoso: Raiders, depois Dreadnoughts, e no canto mais distante o **Leviatã**, uma criatura orgânica colossal que guarda um chip.
- **Rotas Silenciosas**: espaço profundo e vazio além do portal sul de Outer Space. Ali ficam a estação de Heathcliff e a nave de Elyra (ver a sequência secundária).
- **Ametista** é o minério comum; **Turquesa** e **Safira** são mais duras, valem mais e ficam em áreas mais perigosas. Nenhuma das amostras de Ametista mostrou contaminação orgânica.

## Antes de publicar

- `npm test` precisa passar. O bloco "missões" confere que todo `next` aponta para uma missão que existe; acrescente nele a missão nova se ela tiver regra diferente.
- **Não renomeie nem remova** missões publicadas: o `id` está no progresso dos jogadores. Se uma missão sumir do código, quem estava nela tem a sequência dada como terminada.
- "Recomeçar"/"Refazer" no menu de missões (J) volta a sequência ao início, bom para testar as conversas.
- Neste projeto, **commit e push só com aprovação**: o push no `main` publica na Vercel na hora.
