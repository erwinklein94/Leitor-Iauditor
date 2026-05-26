/* =====================================================================
   RUMO · Leitor de Ensaios de Dormente — app.js
   Lê o PDF no navegador (PDF.js), extrai texto com posição e usa o
   RumoParser para montar as tabelas. 100% client-side (GitHub Pages).
   ===================================================================== */
(function () {
  'use strict';

  // Worker do PDF.js (mesma versão do <script> no HTML)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const ICONS = {
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>',
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="5" y="3" width="14" height="13" rx="2"/><path d="M5 10h14M9 20l-2 2M15 20l2 2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M20 6L9 17l-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  };

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const reportsEl = $('#reports');
  const tabsEl = $('#tabs');
  const viewEl = $('#reportView');

  let reports = [];   // { fileName, data }
  let active = 0;

  /* ---------- PDF -> páginas com posições ---------- */
  async function readPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          top: vp.height - it.transform[5], // origem no topo
        }));
      pages.push({ pageNum: n, width: vp.width, height: vp.height, items });
      // a partir de "Resumo de mídia" são apenas fotos — pode parar
      if (items.some((i) => /resumo de m[ií]dia/i.test(i.str))) break;
    }
    return pages;
  }

  /* ---------- carga de arquivos ---------- */
  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.pdf$/i.test(f.name));
    if (!files.length) { showError('Selecione um arquivo PDF.'); return; }

    reportsEl.hidden = false;
    viewEl.innerHTML = '<div class="notice"><div class="spinner"></div><p style="text-align:center;margin:6px 0 0;color:var(--muted)">Lendo relatório…</p></div>';
    reportsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    for (const file of files) {
      try {
        const pages = await readPdf(file);
        const data = RumoParser.parse(pages);
        const total = data.sections.reduce((a, s) => a + s.rows.length, 0);
        if (!total && !data.conclusao) {
          reports.push({ fileName: file.name, data, error: 'Não foi possível reconhecer ensaios neste PDF.' });
        } else {
          reports.push({ fileName: file.name, data });
        }
      } catch (e) {
        console.error(e);
        reports.push({ fileName: file.name, data: null, error: 'Falha ao ler o PDF (' + (e.message || e) + ').' });
      }
    }
    active = reports.length - 1;
    renderTabs();
    renderActive();
  }

  /* ---------- abas (vários relatórios) ---------- */
  function renderTabs() {
    if (reports.length <= 1) { tabsEl.innerHTML = ''; tabsEl.style.display = 'none'; return; }
    tabsEl.style.display = 'flex';
    tabsEl.innerHTML = reports.map((r, i) => {
      const lote = r.data && r.data.meta && r.data.meta['Lote'] ? 'Lote ' + r.data.meta['Lote'] : r.fileName;
      return '<button class="tab ' + (i === active ? 'active' : '') + '" data-i="' + i + '">' +
        ICONS.train + '<span>' + esc(lote) + '</span>' +
        '<span class="x" data-close="' + i + '" title="Remover">✕</span></button>';
    }).join('');
    tabsEl.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', (ev) => {
        const close = ev.target.closest('[data-close]');
        if (close) { ev.stopPropagation(); removeReport(+close.dataset.close); return; }
        active = +t.dataset.i; renderTabs(); renderActive();
      });
    });
  }
  function removeReport(i) {
    reports.splice(i, 1);
    if (!reports.length) { reportsEl.hidden = true; tabsEl.innerHTML = ''; return; }
    active = Math.min(active, reports.length - 1);
    renderTabs(); renderActive();
  }

  /* ---------- render do relatório ativo ---------- */
  function renderActive() {
    const r = reports[active];
    if (!r) return;
    if (r.error || !r.data) {
      viewEl.innerHTML = '<div class="notice"><b>' + esc(r.fileName) + '</b><br>' +
        esc(r.error || 'Erro desconhecido.') + '<br><br>Este leitor é calibrado para o relatório ' +
        '<b>“Ensaio | Dormente de Concreto”</b> exportado do iAuditor.</div>';
      return;
    }
    viewEl.innerHTML = renderReport(r.data);
    bindToolbar(r.data, r.fileName);
  }

  function metaCard(meta) {
    const order = ['Destino', 'Fornecedor', 'Tipo de dormente', 'Lote', 'Molde', 'Cavidade', 'Pista',
      'Fiscal responsável', 'Data do ensaio', 'Data de produção', 'Série de lotes', 'Situação do relatório'];
    const keys = order.filter((k) => meta[k]).concat(Object.keys(meta).filter((k) => order.indexOf(k) === -1));
    const cells = keys.map((k) =>
      '<div><div class="k">' + esc(k) + '</div><div class="v">' + esc(meta[k]) + '</div></div>').join('');
    return '<div class="idcard chamfer"><h3>Identificação do lote</h3><div class="idgrid">' + cells + '</div></div>';
  }

  function banner(concl) {
    if (!concl) return '';
    const ok = concl.situacao === 'ok';
    return '<div class="banner banner--' + (ok ? 'ok' : 'fail') + ' chamfer">' +
      '<div class="seal chamfer">' + (ok ? ICONS.check : ICONS.alert) + '</div>' +
      '<div><div class="lbl">' + esc(concl.ensaio) + '</div>' +
      '<div class="val">' + esc(String(concl.valor).toUpperCase()) + '</div></div></div>';
  }

  function badge(row) {
    return '<span class="badge badge--' + row.situacao + '">' + esc(row.situacaoLabel) + '</span>';
  }

  function table(rows) {
    const body = rows.map((row) => {
      const sub = /^↳/.test(row.ensaio) ? ' sub' : '';
      const name = row.ensaio.replace(/^↳\s*/, '');
      return '<tr class="' + sub.trim() + '">' +
        '<td class="ensaio">' + esc(name) + '</td>' +
        '<td class="num"><span class="valor">' + esc(row.valor) + '</span></td>' +
        '<td class="criterio">' + esc(row.criterio) + '</td>' +
        '<td>' + badge(row) + '</td></tr>';
    }).join('');
    return '<div class="tablewrap chamfer"><table><thead><tr>' +
      '<th>Ensaio</th><th class="num">Carga / Medida aplicada</th>' +
      '<th>Critério / Limite</th><th>Situação</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function section(s) {
    return '<div class="section"><div class="section__head">' +
      '<h3>' + esc(s.title) + '</h3><div class="bar"></div>' +
      '<span class="count">' + s.rows.length + ' ensaios</span></div>' +
      table(s.rows) + '</div>';
  }

  function renderReport(data) {
    return '<div class="report">' +
      metaCard(data.meta) +
      banner(data.conclusao) +
      '<div class="toolbar">' +
        '<button class="btn btn--green" data-act="csv">' + ICONS.download + 'Baixar CSV</button>' +
        (reports.length > 1 ? '<button class="btn btn--ghost" data-act="csvall">' + ICONS.layers + 'CSV de todos</button>' : '') +
        '<button class="btn btn--ghost" data-act="print">' + ICONS.print + 'Imprimir / PDF</button>' +
      '</div>' +
      data.sections.map(section).join('') +
      '</div>';
  }

  /* ---------- exportação ---------- */
  function reportToRows(data) {
    const out = [];
    data.sections.forEach((s) => s.rows.forEach((row) =>
      out.push([s.title, row.ensaio.replace(/^↳\s*/, ''), row.valor, row.criterio, row.situacaoLabel])));
    if (data.conclusao) out.push(['Conclusão', data.conclusao.ensaio, data.conclusao.valor, data.conclusao.criterio, data.conclusao.situacaoLabel]);
    return out;
  }
  function csvField(v) {
    v = String(v == null ? '' : v);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function buildCsv(list) {
    const lines = [];
    list.forEach((item) => {
      const m = item.data.meta;
      lines.push(['# Lote', m['Lote'] || '', 'Fornecedor', m['Fornecedor'] || '', 'Data do ensaio', m['Data do ensaio'] || ''].map(csvField).join(';'));
      lines.push(['Seção', 'Ensaio', 'Carga/Medida aplicada', 'Critério/Limite', 'Situação'].map(csvField).join(';'));
      reportToRows(item.data).forEach((r) => lines.push(r.map(csvField).join(';')));
      lines.push('');
    });
    return '\uFEFF' + lines.join('\r\n'); // BOM p/ Excel
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function bindToolbar(data, fileName) {
    const base = (data.meta['Lote'] ? 'ensaio_lote_' + data.meta['Lote'] : fileName.replace(/\.pdf$/i, '')).replace(/[^\w-]+/g, '_');
    viewEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'csv') download(base + '.csv', buildCsv([reports[active]]));
      else if (act === 'csvall') download('ensaios_dormente_todos.csv', buildCsv(reports.filter((r) => r.data)));
      else if (act === 'print') window.print();
    }));
  }

  function showError(msg) {
    reportsEl.hidden = false;
    viewEl.innerHTML = '<div class="notice"><b>Atenção:</b> ' + esc(msg) + '</div>';
  }

  /* ---------- eventos de upload ---------- */
  fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); fileInput.value = ''; });
  const pickBtn = $('#pickBtn');
  if (pickBtn) pickBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', (e) => { if (e.target.closest('button')) return; fileInput.click(); });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); if (ev !== 'dragleave' || !dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag');
  }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });

  // injeta ícones estáticos
  $('#icUpload').innerHTML = ICONS.upload;
  $('#icTitle').innerHTML = ICONS.train;
})();
