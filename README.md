# Meus Sites — acervo pessoal

Um app local (HTML + CSS + JS puro, sem nenhuma dependência externa) pra
guardar seus próprios sites — 10 mil, 50 mil, o quanto o armazenamento do
seu aparelho aguentar — e abri-los depois, offline, em qualquer lugar.

## Como usar

**Não precisa instalar nada.** É só abrir o `index.html` — no celular ou no
computador — e o app já funciona 100%, mesmo sem internet, porque nenhum
arquivo aqui dentro carrega nada de fora.

Duas formas de usar:

1. **Direto do arquivo**: descompacte a pasta e abra `index.html` no
   navegador (Chrome, Firefox, Safari). Funciona offline desde o primeiro
   segundo.
2. **Instalado como app** (recomendado no celular): hospede a pasta uma
   vez em algum lugar (ex.: GitHub Pages, Netlify, ou um servidor local
   tipo `python3 -m http.server`), abra pelo navegador do celular e use
   "Adicionar à tela de início". Depois disso ele funciona como um app de
   verdade — ícone próprio, tela cheia, e 100% offline dali pra frente,
   sem sinal nenhum. Essa parte (o service worker) só ativa em `https://`
   ou `localhost` — em `file://` ela é ignorada e o resto do app continua
   funcionando normalmente.

## Adicionando um site

Toque em **"+ Site"**. Você pode trazer os arquivos de três formas:

- **Selecionar arquivo(s)**: escolha o `.html` e, se tiver, o `.css`, `.js`
  e imagens junto — funciona em qualquer aparelho, mas perde subpastas
  (tudo entra "solto").
- **Selecionar pasta**: no computador (Chrome/Edge), escolhe a pasta
  inteira do site e mantém a estrutura de subpastas (`css/`, `js/`,
  `images/`...) certinha.
- **Importar .zip**: a forma mais confiável no celular. Compacte a pasta
  do site (no iPhone, o próprio app Arquivos tem "Comprimir"; no Android,
  qualquer app de arquivos faz isso) e importe o `.zip` aqui — as
  subpastas são preservadas automaticamente.

Se o site tiver mais de um arquivo `.html`, escolha qual é o principal
(o que abre primeiro). O ícone é detectado automaticamente a partir do
favicon do site, ou você escolhe uma imagem sua — se não fizer nada, um
ícone com as iniciais do nome é gerado sozinho.

## Isolamento (a parte importante)

Cada site guardado abre dentro de um `<iframe sandbox>`. Duas coisas
diferentes estão em jogo aqui, e vale separar:

- **CSS nunca vaza** — isso é básico de como iframes funcionam, com ou
  sem sandbox: o `<style>`/`<link>` de um site guardado jamais afeta o
  app principal, nem o contrário. Isso é garantido sempre.
- **JavaScript roda com `allow-same-origin`** — pra que o site consiga
  usar `localStorage`/`IndexedDB` normalmente (muitos sites reais
  dependem disso pra funcionar; sem isso, qualquer site com esse tipo de
  recurso simplesmente quebra). A troca é que, tecnicamente, o script do
  site *poderia* tentar acessar `parent.document` enquanto está aberto,
  já que passa a compartilhar a mesma origem do app. Continua bloqueado
  de navegar a aba inteira (`allow-top-navigation` fica de fora) ou
  sequestrar o app de outras formas mais drásticas.

Na prática, isso é seguro pro uso pretendido — **seus próprios sites**,
que você mesmo escreveu. Não é pensado pra guardar sites de terceiros em
quem você não confia.

**Um detalhe pra ficar de olho**: como o JS agora roda na mesma origem do
app, se dois sites diferentes do seu acervo usarem `localStorage` ou
`IndexedDB` com nomes bem genéricos (tipo uma chave chamada `"dados"` ou
um banco chamado `"appDB"`), os dados de um podem se misturar com os do
outro, já que — do ponto de vista do navegador — ambos "moram" no mesmo
lugar. Isso não afeta o acervo em si (ele usa um nome de banco bem
específico, `MeusSitesVaultDB`, que não deve colidir por acidente), só a
própria lógica interna de cada site guardado, se ela depender de
armazenamento local com nomes muito genéricos. Se algum dos seus sites
for sensível a isso, vale usar um nome de chave único (o nome do próprio
site, por exemplo) no código dele.

Links internos (entre páginas do mesmo site) continuam funcionando —
são reescritos por baixo dos panos. Links externos (`http://...`) abrem
numa aba nova, já que isso depende de internet de verdade. Formulários
que enviam dados pra um servidor não funcionam, porque aqui não existe
backend nenhum — é tudo estático e local.

## Busca, ordenação e organização

A busca cobre nome, descrição e tags, e funciona instantaneamente mesmo
com milhares de sites (o índice fica todo em memória — só os arquivos
pesados de cada site são carregados na hora de abrir). A grade carrega em
lotes conforme você rola a tela, então não trava mesmo com um acervo
gigante.

## Backup (exportar / importar)

- **Exportar um site**: no menu "⋮" do card, ou dentro do site aberto.
  Gera um `.json` com tudo daquele site (arquivos + ícone, tudo embutido).
- **Exportar tudo**: botão de download no topo. Gera um `.json` único com
  o acervo inteiro — guarde esse arquivo em outro lugar de vez em quando
  (nuvem, pendrive, outro aparelho). É a sua rede de segurança.
- **Importar**: aceita tanto esses `.json` quanto `.zip` de sites novos,
  vários de uma vez se quiser.

Tudo fica gravado em IndexedDB, que é durável, mas nenhum navegador é
100% à prova de "usuário limpou os dados do site sem querer" — por isso
os backups. O app já pede armazenamento persistente ao navegador
automaticamente (reduz bastante o risco do sistema apagar os dados sob
pressão de espaço).

## Estrutura dos arquivos

```
index.html            a interface
style.css              o visual
app.js                  toda a lógica (IndexedDB, leitor de .zip, isolamento, etc.)
manifest.webmanifest    metadados pra instalar como app
sw.js                   cache offline (só ativa em https/localhost)
icons/                  ícones do app instalado
```

Nenhum desses arquivos faz nenhuma chamada de rede. É seguro usar numa
fazenda, numa selva, num avião, ou onde mais precisar.
