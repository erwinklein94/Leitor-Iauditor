# RUMO · Leitor de Relatórios iAuditor

Site estático que lê PDFs exportados do **iAuditor / SafetyCulture** para relatórios de **dormente de concreto** e apresenta os dados em **tabelas**, com campo/ensaio, valor, critério/limite e situação quando for possível calcular.

Tudo roda **100% no navegador** com PDF.js. Nenhum PDF é enviado para servidor.

## Modelos reconhecidos nesta versão

O leitor foi ajustado com base nos relatórios de exemplo do pacote `varios tipos de relatórios padrão do iauditor.zip` e agora reconhece estes formatos:

- **Ensaio | Dormente de Concreto**: ensaios de cargas, dimensionais, conclusão e critérios técnicos já conhecidos.
- **Ensaio de bitola | Dormente de Concreto**: dormentes 01 a 10, lote, molde, cavidade e medida encontrada na régua de bitola.
- **Inspeção de pista | Dormente de Concreto**: dormentes reprovados, dormentes reparados e quantidades por tipo de defeito.
- **Concretagem | Dormente de Concreto**: termômetros do fornecedor, temperatura de lançamento RUMO, Slump Test de abatimento/espalhamento e conclusão.
- **Arrancamento de USP | Dormente de Concreto**: cargas por posição A1/A2/B1/B2 e conclusão.

Além do dicionário técnico dos ensaios de dormente, o parser tem uma extração genérica por layout. Isso ajuda a ler novos relatórios do iAuditor que mantenham o padrão de **pergunta/campo à esquerda** e **valor à direita**.

## Estrutura

```text
Leitor-Iauditor-main/
├── index.html      # página principal
├── parser.js       # lógica de extração dos PDFs
├── app.js          # leitura com PDF.js, abas, tabela e exportação CSV
├── styles.css      # identidade visual
└── README.md
```

## Como usar

1. Abra o site por um servidor local ou publique no GitHub Pages.
2. Arraste um ou mais PDFs para a área indicada.
3. Cada relatório vira uma aba.
4. Use os botões para exportar CSV individual, CSV de todos ou imprimir/salvar em PDF.

## Rodar localmente

Por usar PDF.js, prefira abrir por servidor local:

```bash
cd Leitor-Iauditor-main
python3 -m http.server 8000
# acesse http://localhost:8000
```

## Publicar no GitHub Pages

1. Envie estes arquivos para a raiz de um repositório GitHub.
2. Em **Settings → Pages**, escolha **Deploy from a branch**.
3. Selecione a branch principal e a pasta `/ (root)`.
4. Aguarde a URL do GitHub Pages ficar disponível.

## Notas técnicas

- `app.js` envia ao parser texto, posição horizontal, posição vertical e largura aproximada de cada item extraído pelo PDF.js.
- `parser.js` agrupa itens em linhas e células, detecta seções dinamicamente e ignora fotos, rodapés e páginas de mídia.
- A coluna **Situação** é calculada quando há critério claro, como faixa de temperatura, limite máximo, status aprovado/conforme ou critérios já conhecidos no dicionário técnico.
- Quando o relatório contém apenas medição sem limite explícito, a situação aparece como **Medido**.
