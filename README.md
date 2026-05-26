# RUMO · Leitor de Ensaios de Dormente

Site estático que lê relatórios PDF de **ensaio de dormente de concreto** exportados do **iAuditor** e os apresenta em **tabela**, com o ensaio e a respectiva **carga ou medida aplicada**, o critério/limite e a situação. Suporta vários relatórios ao mesmo tempo (uma aba por lote) e exporta para **CSV** (compatível com Excel) ou impressão/PDF.

Tudo roda **100% no navegador** com [PDF.js](https://mozilla.github.io/pdf.js/) — nenhum arquivo é enviado para servidor. Por isso funciona direto no **GitHub Pages**.

## Estrutura

```
site/
├── index.html              # página
├── .nojekyll               # impede o Jekyll de ignorar pastas/arquivos
└── assets/
    ├── css/styles.css      # identidade visual Rumo (azul-escuro, branco, verde, amarelo)
    └── js/
        ├── parser.js       # extrai ensaio + valor + critério + situação (independente do DOM)
        └── app.js          # lê o PDF, monta as tabelas, exporta CSV/imprime
```

## Como usar

1. Abra o site.
2. Arraste um ou mais PDFs para a área indicada (ou clique em **Selecionar PDFs**).
3. Cada relatório vira uma aba; a tabela traz **Ensaio · Carga/Medida aplicada · Critério/Limite · Situação**.
4. Use os botões para exportar **CSV** (individual ou de todos) ou **Imprimir / PDF**.

## Publicar no GitHub Pages

Opção A — publicar a pasta `site/` como raiz do site:

1. Crie um repositório e suba o **conteúdo de dentro de `site/`** na raiz do repositório (ou seja, `index.html` deve ficar na raiz).
2. Em **Settings → Pages**, em *Build and deployment*, selecione **Deploy from a branch**.
3. Escolha a branch (ex.: `main`) e a pasta `/ (root)`. Salve.
4. Aguarde alguns instantes e acesse a URL informada (`https://SEU-USUARIO.github.io/SEU-REPO/`).

Opção B — manter a pasta `site/`:

- Suba o projeto como está e, em **Settings → Pages**, selecione a pasta **`/site`** (ou `/docs`, se renomear). Salve.

O arquivo `.nojekyll` já está incluído para evitar que o GitHub Pages (Jekyll) ignore arquivos/pastas.

## Rodar localmente

Por usar `fetch`/Web Worker, abra via servidor local (não pelo `file://`):

```bash
cd site
python3 -m http.server 8000
# acesse http://localhost:8000
```

## Notas técnicas

- O `parser.js` usa **posição do texto** (rótulo à esquerda, valor à direita) e um dicionário canônico do modelo *Dormente de Concreto*, com fallback genérico para outros checklists do iAuditor.
- A coluna **Situação** é calculada a partir do critério do próprio relatório (dentro do limite / conforme / aprovado).
- O PDF.js é carregado por CDN (cdnjs, v3.11.174); é só o que precisa de internet em tempo de execução.
