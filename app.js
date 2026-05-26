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
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const HISTORY_KEY = 'rumo_iauditor_historico_v1';
  const HISTORY_TYPES = [
    { value: 'liberacao', label: 'Ensaio de liberação' },
    { value: 'arrancamento-usp', label: 'Ensaio de arrancamento de USP' },
    { value: 'bitola', label: 'Ensaio de bitola' },
    { value: 'inspecao-pista', label: 'Inspeção de pista' },
  ];
  const TYPE_LABEL = HISTORY_TYPES.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {});

  const ICONS = {
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>',
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="5" y="3" width="14" height="13" rx="2"/><path d="M5 10h14M9 20l-2 2M15 20l2 2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M20 6L9 17l-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const reportsEl = $('#reports');
  const tabsEl = $('#tabs');
  const viewEl = $('#reportView');
  const importPanel = $('#importPanel');
  const historyPanel = $('#historyPanel');
  const historyView = $('#historyView');
  const historyCount = $('#historyCount');
  const filterTipo = $('#filterTipo');

  let reports = [];   // { fileName, data, historyId, fromHistory }
  let active = 0;
  let historyItems = loadHistory();

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
          w: it.width || 0
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

    showMainView('import');
    reportsEl.hidden = false;
    viewEl.innerHTML = '<div class="notice"><div class="spinner"></div><p style="text-align:center;margin:6px 0 0;color:var(--muted)">Lendo relatório…</p></div>';
    reportsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    for (const file of files) {
      try {
        const pages = await readPdf(file);
        const data = RumoParser.parse(pages);
        const total = data.sections.reduce((a, s) => a + s.rows.length, 0);
        if (!total && !data.conclusao) {
          reports.push({ fileName: file.name, data, error: 'Não foi possível reconhecer campos ou ensaios neste PDF.' });
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

  /* ---------- abas de navegação principal ---------- */
  function showMainView(view) {
    const showHistory = view === 'history';
    if (importPanel) importPanel.hidden = showHistory;
    if (historyPanel) historyPanel.hidden = !showHistory;
    $$('[data-main-view]').forEach((btn) => btn.classList.toggle('active', btn.dataset.mainView === view));
    if (showHistory) renderHistory();
  }

  function initMainTabs() {
    $$('[data-main-view]').forEach((btn) => btn.addEventListener('click', () => showMainView(btn.dataset.mainView)));
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
    $$('.tab', tabsEl).forEach((t) => {
      t.addEventListener('click', (ev) => {
        const close = ev.target.closest('[data-close]');
        if (close) { ev.stopPropagation(); removeReport(+close.dataset.close); return; }
        active = +t.dataset.i; renderTabs(); renderActive();
      });
    });
  }
  function removeReport(i) {
    reports.splice(i, 1);
    if (!reports.length) { reportsEl.hidden = true; tabsEl.innerHTML = ''; viewEl.innerHTML = ''; return; }
    active = Math.min(active, reports.length - 1);
    renderTabs(); renderActive();
  }

  /* ---------- render do relatório ativo ---------- */
  function renderActive() {
    const r = reports[active];
    if (!r) return;
    if (r.error || !r.data) {
      viewEl.innerHTML = '<div class="notice"><b>' + esc(r.fileName) + '</b><br>' +
        esc(r.error || 'Erro desconhecido.') + '<br><br>Este leitor foi preparado para relatórios iAuditor de dormente de concreto.</div>';
      return;
    }
    viewEl.innerHTML = renderReport(r);
    bindToolbar(r);
  }

  function metaCard(meta) {
    const order = ['Destino', 'Fornecedor', 'Projeto', 'Tipo de dormente', 'Lote', 'Molde', 'Cavidade', 'Pista',
      'Fiscal responsável', 'Data do ensaio', 'Data da fabricação/inspeção', 'Data de produção', 'Série de lotes', 'Situação do relatório'];
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
      '<th>Campo / Ensaio</th><th class="num">Valor</th>' +
      '<th>Critério / Limite</th><th>Situação</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function section(s) {
    return '<div class="section"><div class="section__head">' +
      '<h3>' + esc(s.title) + '</h3><div class="bar"></div>' +
      '<span class="count">' + s.rows.length + ' ensaios</span></div>' +
      table(s.rows) + '</div>';
  }

  function typeOptions(selected) {
    return HISTORY_TYPES.map((t) => '<option value="' + esc(t.value) + '"' + (t.value === selected ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('');
  }

  function decisionPanel(report) {
    const suggested = report.historyType || classifyReport(report.data);
    const saved = report.historyId && historyItems.some((item) => item.id === report.historyId);
    return '<div class="decision-panel chamfer">' +
      '<label>Tipo para o histórico' +
        '<select class="history-type-select" data-history-type>' + typeOptions(suggested) + '</select>' +
        '<span class="decision-note">Classificação automática editável antes de salvar.</span>' +
      '</label>' +
      (saved
        ? '<span class="saved-note">✓ Salvo no histórico</span>'
        : '<button class="btn btn--green" type="button" data-act="save-history">' + ICONS.save + 'Salvar no histórico</button>') +
      '<button class="btn btn--danger" type="button" data-act="discard">' + ICONS.trash + 'Descartar</button>' +
      '</div>';
  }

  function renderReport(report) {
    const data = report.data;
    return '<div class="report">' +
      metaCard(data.meta) +
      decisionPanel(report) +
      banner(data.conclusao) +
      '<div class="toolbar">' +
        '<button class="btn btn--green" data-act="csv">' + ICONS.download + 'Baixar CSV</button>' +
        (reports.length > 1 ? '<button class="btn btn--ghost" data-act="csvall">' + ICONS.layers + 'CSV de todos</button>' : '') +
        '<button class="btn btn--ghost" data-act="print">' + ICONS.print + 'Imprimir / PDF</button>' +
        '<button class="btn btn--ghost" data-act="go-history">' + ICONS.layers + 'Ver histórico</button>' +
      '</div>' +
      data.sections.map(section).join('') +
      '</div>';
  }

  /* ---------- classificação e histórico ---------- */
  function getMeta(data, keys) {
    for (const k of keys) {
      if (data && data.meta && data.meta[k]) return data.meta[k];
    }
    return '';
  }

  function allReportText(data) {
    if (!data) return '';
    const parts = [];
    Object.keys(data.meta || {}).forEach((k) => parts.push(k, data.meta[k]));
    (data.sections || []).forEach((s) => {
      parts.push(s.title);
      (s.rows || []).forEach((r) => parts.push(r.ensaio, r.valor, r.criterio, r.situacaoLabel));
    });
    if (data.conclusao) parts.push(data.conclusao.ensaio, data.conclusao.valor);
    return parts.join(' ');
  }

  function classifyReport(data) {
    const text = norm(allReportText(data));
    const reportType = norm(getMeta(data, ['Tipo de relatório']));

    if (reportType.includes('ensaio de bitola') || text.includes('regua de bitola') || text.includes('medida encontrada na regua de bitola')) return 'bitola';
    if (reportType.includes('inspecao de pista')) return 'inspecao-pista';
    if (text.includes('momento positivo') || text.includes('momento negativo') || text.includes('ensaios de cargas')) return 'liberacao';
    if (text.includes('arrancamento')) return 'arrancamento-usp';
    if (text.includes('carga aplicada') || text.includes('apoio dos trilhos')) return 'liberacao';
    if (reportType.includes('inspecao')) return 'inspecao-pista';
    return 'liberacao';
  }

  function normalizeEmpresa(text) {
    const n = norm(text);
    if (n.includes('cavan')) return 'Cavan';
    if (n.includes('conprem')) return 'Conprem';
    return '';
  }

  function parseDateISO(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let m = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return m[1].padStart(4, '0') + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = m[3];
      if (y.length === 2) y = '20' + y;
      return y.padStart(4, '0') + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    return '';
  }

  function formatDateBR(iso, fallback) {
    if (!iso) return fallback || '—';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : (fallback || iso);
  }

  function createHistoryItem(report, type) {
    const data = report.data;
    const dataLabel = getMeta(data, ['Data do ensaio', 'Data da fabricação/inspeção', 'Data da fabricação', 'Data de produção']) || '';
    const projeto = getMeta(data, ['Projeto', 'Destino']) || '';
    const fornecedor = getMeta(data, ['Fornecedor']) || '';
    const empresa = normalizeEmpresa([fornecedor, projeto, allReportText(data)].join(' '));
    const item = {
      id: 'hist_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      savedAt: new Date().toISOString(),
      fileName: report.fileName,
      tipo: type || classifyReport(data),
      dataLabel,
      dataISO: parseDateISO(dataLabel),
      lote: getMeta(data, ['Lote']) || '',
      projeto,
      empresa,
      fornecedor,
      pista: getMeta(data, ['Pista']) || '',
      data
    };
    item.signature = historySignature(item);
    return item;
  }

  function historySignature(item) {
    return norm([item.tipo, item.lote, item.dataISO || item.dataLabel, item.projeto, item.empresa, item.fileName].join('|'));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Não foi possível carregar o histórico.', e);
      return [];
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyItems));
      updateHistoryCount();
    } catch (e) {
      console.error('Não foi possível salvar o histórico.', e);
      showToast('Não foi possível salvar: o armazenamento local está cheio ou bloqueado.');
    }
  }

  function updateHistoryCount() {
    if (historyCount) historyCount.textContent = String(historyItems.length);
  }

  function saveActiveToHistory() {
    const report = reports[active];
    if (!report || !report.data) return;
    const select = $('[data-history-type]', viewEl);
    const type = select ? select.value : classifyReport(report.data);
    report.historyType = type;
    const item = createHistoryItem(report, type);
    const duplicate = historyItems.find((old) => (old.signature || historySignature(old)) === item.signature);
    if (duplicate) {
      report.historyId = duplicate.id;
      showToast('Este resultado já estava salvo no histórico.');
      renderActive();
      return;
    }
    historyItems.unshift(item);
    report.historyId = item.id;
    persistHistory();
    showToast('Resultado salvo no histórico.');
    renderActive();
  }

  function discardActive() {
    removeReport(active);
    showToast('Informações importadas descartadas.');
  }

  function populateTypeFilters() {
    if (filterTipo) filterTipo.innerHTML = '<option value="">Todos</option>' + typeOptions('');
  }

  function getHistoryFilters() {
    return {
      from: $('#filterDateFrom') ? $('#filterDateFrom').value : '',
      to: $('#filterDateTo') ? $('#filterDateTo').value : '',
      lote: norm($('#filterLote') ? $('#filterLote').value : ''),
      tipo: $('#filterTipo') ? $('#filterTipo').value : '',
      projeto: norm($('#filterProjeto') ? $('#filterProjeto').value : ''),
      empresa: $('#filterEmpresa') ? $('#filterEmpresa').value : '',
    };
  }

  function historyMatches(item, f) {
    const itemDate = item.dataISO || parseDateISO(item.dataLabel);
    if (f.from && (!itemDate || itemDate < f.from)) return false;
    if (f.to && (!itemDate || itemDate > f.to)) return false;
    if (f.lote && !norm(item.lote).includes(f.lote)) return false;
    if (f.tipo && item.tipo !== f.tipo) return false;
    if (f.projeto && !norm(item.projeto).includes(f.projeto)) return false;
    if (f.empresa && item.empresa !== f.empresa) return false;
    return true;
  }

  function renderHistory() {
    updateHistoryCount();
    if (!historyView) return;
    const filters = getHistoryFilters();
    const results = historyItems.filter((item) => historyMatches(item, filters));

    if (!historyItems.length) {
      historyView.innerHTML = '<div class="empty-history chamfer"><h3>Nenhum resultado salvo ainda.</h3><p>Importe um relatório iAuditor e clique em “Salvar no histórico” para guardar as informações extraídas.</p></div>';
      return;
    }

    if (!results.length) {
      historyView.innerHTML = '<div class="empty-history chamfer"><h3>Nenhum resultado encontrado.</h3><p>Altere os filtros de data, lote, tipo, projeto ou empresa para ampliar a busca.</p></div>';
      return;
    }

    const groups = HISTORY_TYPES.map((t) => ({ type: t, items: results.filter((item) => item.tipo === t.value) }))
      .filter((g) => g.items.length);

    const overview = '<div class="history-overview">' +
      '<article class="history-stat history-stat--main chamfer">' +
        '<div class="history-stat__label">Resumo do histórico</div>' +
        '<div class="history-stat__value">' + results.length + '</div>' +
        '<div class="history-stat__sub">resultado(s) exibido(s) de um total de ' + historyItems.length + ' salvo(s).</div>' +
      '</article>' +
      HISTORY_TYPES.map((t) => {
        const count = results.filter((item) => item.tipo === t.value).length;
        return '<article class="history-stat chamfer">' +
          '<div class="history-stat__label">' + esc(t.label) + '</div>' +
          '<div class="history-stat__value">' + count + '</div>' +
          '<div class="history-stat__sub">registro(s) nesta categoria</div>' +
        '</article>';
      }).join('') +
      '</div>';

    historyView.innerHTML = overview +
      '<p class="history-summary">Exibindo <b>' + results.length + '</b> resultado(s) encontrado(s) no histórico com os filtros atuais.</p>' +
      groups.map((g) => '<section class="history-group history-group-card chamfer">' +
        '<div class="history-group__head"><h3>' + esc(g.type.label) + '</h3><div class="bar"></div><span class="count">' + g.items.length + '</span></div>' +
        '<div class="history-grid">' + g.items.map(historyCard).join('') + '</div>' +
        '</section>').join('');

    $$('[data-history-open]', historyView).forEach((btn) => btn.addEventListener('click', () => openHistoryItem(btn.dataset.historyOpen)));
    $$('[data-history-csv]', historyView).forEach((btn) => btn.addEventListener('click', () => exportHistoryItem(btn.dataset.historyCsv)));
    $$('[data-history-delete]', historyView).forEach((btn) => btn.addEventListener('click', () => deleteHistoryItem(btn.dataset.historyDelete)));
  }

  function historyCard(item) {
    const title = item.lote ? 'Lote ' + item.lote : (item.fileName || 'Resultado sem lote');
    const dateText = formatDateBR(item.dataISO, item.dataLabel);
    const savedText = formatDateBR((item.savedAt || '').slice(0, 10), '—');
    const typeLabel = TYPE_LABEL[item.tipo] || 'Resultado salvo';
    return '<article class="history-card history-card--' + esc(item.tipo || 'outro') + ' chamfer">' +
      '<div class="history-card__header">' +
        '<div>' +
          '<span class="history-badge">' + esc(typeLabel) + '</span>' +
          '<h4>' + esc(title) + '</h4>' +
          '<p>' + esc(item.fileName || 'Relatório salvo') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="history-chip-row">' +
        historyChip('Data', dateText) +
        historyChip('Empresa', item.empresa || '—') +
        historyChip('Projeto', item.projeto || '—') +
      '</div>' +
      '<div class="history-card__meta">' +
        historyMeta('Data do ensaio', dateText) +
        historyMeta('Projeto', item.projeto || '—') +
        historyMeta('Empresa', item.empresa || '—') +
        historyMeta('Fornecedor', item.fornecedor || '—') +
        historyMeta('Pista', item.pista || '—') +
        historyMeta('Salvo em', savedText) +
      '</div>' +
      '<div class="history-card__actions">' +
        '<button class="btn" type="button" data-history-open="' + esc(item.id) + '">' + ICONS.eye + 'Ver resultado</button>' +
        '<button class="btn btn--green" type="button" data-history-csv="' + esc(item.id) + '">' + ICONS.download + 'Baixar CSV</button>' +
        '<button class="btn btn--danger" type="button" data-history-delete="' + esc(item.id) + '">' + ICONS.trash + 'Excluir</button>' +
      '</div>' +
      '</article>';
  }

  function historyMeta(k, v) {
    return '<div><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }

  function historyChip(k, v) {
    return "<span class=\"history-chip\"><span>" + esc(k) + "</span>" + esc(v) + "</span>";
  }

  function openHistoryItem(id) {
    const item = historyItems.find((h) => h.id === id);
    if (!item) return;
    reports.push({ fileName: item.fileName || 'Histórico', data: item.data, historyId: item.id, historyType: item.tipo, fromHistory: true });
    active = reports.length - 1;
    reportsEl.hidden = false;
    showMainView('import');
    renderTabs();
    renderActive();
    reportsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportHistoryItem(id) {
    const item = historyItems.find((h) => h.id === id);
    if (!item) return;
    const base = (item.lote ? 'historico_lote_' + item.lote : (item.fileName || 'historico')).replace(/[^\w-]+/g, '_');
    download(base + '.csv', buildCsv([{ fileName: item.fileName, data: item.data }]));
  }

  function deleteHistoryItem(id) {
    const item = historyItems.find((h) => h.id === id);
    if (!item) return;
    const title = item.lote ? 'Lote ' + item.lote : item.fileName;
    if (!window.confirm('Excluir do histórico: ' + title + '?')) return;
    historyItems = historyItems.filter((h) => h.id !== id);
    reports.forEach((r) => { if (r.historyId === id) r.historyId = null; });
    persistHistory();
    renderHistory();
    if (!importPanel.hidden) renderActive();
  }

  function bindHistoryFilters() {
    ['filterDateFrom', 'filterDateTo', 'filterLote', 'filterTipo', 'filterProjeto', 'filterEmpresa'].forEach((id) => {
      const el = $('#' + id);
      if (!el) return;
      const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(ev, renderHistory);
    });
    const clear = $('#clearHistoryFilters');
    if (clear) clear.addEventListener('click', () => {
      ['filterDateFrom', 'filterDateTo', 'filterLote', 'filterTipo', 'filterProjeto', 'filterEmpresa'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
      renderHistory();
    });
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
      lines.push(['# Lote', m['Lote'] || '', 'Fornecedor', m['Fornecedor'] || '', 'Projeto', m['Projeto'] || '', 'Data do ensaio', m['Data do ensaio'] || ''].map(csvField).join(';'));
      lines.push(['Seção', 'Campo/Ensaio', 'Valor', 'Critério/Limite', 'Situação'].map(csvField).join(';'));
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

  function bindToolbar(report) {
    const data = report.data;
    const fileName = report.fileName;
    const base = (data.meta['Lote'] ? 'ensaio_lote_' + data.meta['Lote'] : fileName.replace(/\.pdf$/i, '')).replace(/[^\w-]+/g, '_');
    $$('[data-act]', viewEl).forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'csv') download(base + '.csv', buildCsv([reports[active]]));
      else if (act === 'csvall') download('ensaios_dormente_todos.csv', buildCsv(reports.filter((r) => r.data)));
      else if (act === 'print') window.print();
      else if (act === 'save-history') saveActiveToHistory();
      else if (act === 'discard') discardActive();
      else if (act === 'go-history') showMainView('history');
    }));
    const typeSelect = $('[data-history-type]', viewEl);
    if (typeSelect) typeSelect.addEventListener('change', () => { report.historyType = typeSelect.value; });
  }

  function showError(msg) {
    showMainView('import');
    reportsEl.hidden = false;
    viewEl.innerHTML = '<div class="notice"><b>Atenção:</b> ' + esc(msg) + '</div>';
  }

  function showToast(msg) {
    const node = document.createElement('div');
    node.className = 'notice chamfer';
    node.style.position = 'fixed';
    node.style.right = '18px';
    node.style.bottom = '18px';
    node.style.zIndex = '100';
    node.style.maxWidth = '360px';
    node.innerHTML = '<b>' + esc(msg) + '</b>';
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
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

  // inicialização
  initMainTabs();
  populateTypeFilters();
  bindHistoryFilters();
  updateHistoryCount();
  renderHistory();

  // injeta ícones estáticos
  $('#icUpload').innerHTML = ICONS.upload;
  $('#icTitle').innerHTML = ICONS.train;
})();
