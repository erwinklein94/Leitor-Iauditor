/* =====================================================================
   RUMO · Leitor de Relatórios iAuditor
   parser.js — extração pura (sem DOM, testável em Node)

   Entrada esperada: lista de páginas no formato
     [{ pageNum, width, height, items: [{ str, x, top, w? }] }]

   Estratégia:
     1) mantém dicionário técnico para ensaios de dormente;
     2) usa extração genérica por layout para outros modelos do iAuditor:
        Inspeção de pista, Concretagem, Ensaio de bitola etc.;
     3) detecta seções dinamicamente, em vez de depender de um único
        checklist/exportação.
   ===================================================================== */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RumoParser = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ---------- utilidades de texto ---------- */
  const norm = (s) =>
    (s || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const compact = (s) => (s || '').replace(/\s+/g, '');
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const titleCaseSmall = (s) => clean(s).replace(/\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,})\b/g, (m) => {
    if (m === 'USP' || m === 'FMT' || m === 'RUMO') return m;
    return m.charAt(0) + m.slice(1).toLowerCase();
  });

  const RE_NUM = /^-?\d{1,6}([.,]\d+)?$/;
  const RE_NUM_UNIT = /^-?\d{1,6}([.,]\d+)?\s*(kn|mm|n\.?m|n·m|nm|n|°?c|c|%)$/i;
  const RE_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
  const RE_STATUS = /^(sim|nao|não|aprovado|reprovado|conforme|naoconforme|nao conforme|não conforme|ok)$/i;
  const RE_NOISE = [
    /^foto\s*\d+$/i,
    /^fotos$/i,
    /^\d+\s*\/\s*\d+$/,
    /^private\s*&\s*confidential$/i,
  ];

  function isNoise(str) {
    const t = clean(str);
    const c = compact(t);
    if (!c) return true;
    if (RE_NOISE.some((r) => r.test(t))) return true;
    if (/^pagina\d+$/i.test(norm(t))) return true;
    // rodapé recorrente: "Projeto / Lote / Fornecedor / Data / Responsável"
    if (/\/.*\/.*\//.test(t) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return true;
    return false;
  }

  function isValueToken(str) {
    const c = compact(str).replace(/−/g, '-');
    const n = norm(c);
    return RE_NUM.test(c) || RE_NUM_UNIT.test(c) || RE_STATUS.test(str) || /^-?\d+(?:[.,]\d+)?°?c$/i.test(c) || RE_DATE.test(c) || n === 'semusp';
  }

  function toNumber(v) {
    const s = String(v == null ? '' : v)
      .replace(/−/g, '-')
      .replace(/[^0-9.,-]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function hasUnit(v) { return /[a-zA-Z°]/.test(v); }

  /* ---------- dicionário técnico do modelo "Dormente de Concreto" ---------- */
  const DICT = [
    // ---- cargas ----
    { key: 'momentopositivonoapoiodostrilhosapresentoufissuras', name: '↳ Apresentou fissuras? (apoio, positivo)', kind: 'bool' },
    { key: 'momentopositivonoapoiodostrilhos', name: 'Momento positivo no apoio dos trilhos', unit: 'kN', crit: 'Não deve fissurar' },
    { key: 'momentonegativonoapoiodostrilhosapresentoufissuras', name: '↳ Apresentou fissuras? (apoio, negativo)', kind: 'bool' },
    { key: 'momentonegativonoapoiodostrilhos', name: 'Momento negativo no apoio dos trilhos', unit: 'kN', crit: 'Não deve fissurar' },
    { key: 'momentopositivonocentrododormenteapresentoufissuras', name: '↳ Apresentou fissuras? (centro, positivo)', kind: 'bool' },
    { key: 'momentopositivonocentrododormente', name: 'Momento positivo no centro do dormente', unit: 'kN', crit: 'Não deve fissurar' },
    { key: 'momentonegativonocentrododormenteapresentoufissuras', name: '↳ Apresentou fissuras? (centro, negativo)', kind: 'bool' },
    { key: 'momentonegativonocentrododormente', name: 'Momento negativo no centro do dormente', unit: 'kN', crit: 'Não deve fissurar' },
    { key: 'naancoragemapresentoufissura', name: '↳ Ancoragem: fissura > 0,5 mm após descarga?', kind: 'bool' },
    { key: 'ancoragemcargaaplicada50', name: 'Ancoragem (carga 50% acima do mom. positivo)', unit: 'kN', crit: 'Sem fissura > 0,5 mm após descarga' },
    { key: 'ancoragemmomentopositivonosapoiosdostrilhos', name: 'Ancoragem (momento positivo nos apoios)', unit: 'kN', crit: 'Sem fissura > 0,5 mm após descarga' },
    { key: 'fissuracaonomomentopositivonosapoiosdostrilhos', name: 'Fissuração no momento positivo nos apoios dos trilhos', unit: 'kN', crit: 'Sem fissura > 0,5 mm após descarga' },
    { key: 'aderenciaescorregamento', name: 'Aderência — escorregamento do aço', crit: 'Máx. 0,025 mm', max: 0.025 },
    { key: 'cargaultimanomomentopositivonoapoiodostrilhos', name: 'Aderência — escorregamento do aço', crit: 'Máx. 0,025 mm', max: 0.025 },
    { key: 'ensaiodearrancamentonaombreiraa', name: 'Arrancamento na ombreira A', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'ensaiodearrancamentonaombreirab', name: 'Arrancamento na ombreira B', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'ensaiodearrancamentonaombreirac', name: 'Arrancamento na ombreira C', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'arrancamentonaombreiraa', name: 'Arrancamento na ombreira A', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'arrancamentonaombreirab', name: 'Arrancamento na ombreira B', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'arrancamentonaombreirac', name: 'Arrancamento na ombreira C', unit: 'kN', crit: 'Carga 53,40 kN' },
    // ---- dimensionais ----
    { key: 'inclinacaodabasedeapoiodostrilhos', name: 'Inclinação da base de apoio dos trilhos', crit: 'Entre 1:35 e 1:45' },
    { key: 'empenotransversal', name: 'Empeno transversal (torção) entre apoios', crit: 'Máx. 1 mm', max: 1 },
    { key: 'ensaiodetorcaonaombreiraa', name: 'Torção na ombreira A', kind: 'status', crit: 'Carga 340 N·m' },
    { key: 'ensaiodetorcaonaombreirab', name: 'Torção na ombreira B', kind: 'status', crit: 'Carga 340 N·m' },
    { key: 'ensaiodetorcaonaombreirac', name: 'Torção na ombreira C', kind: 'status', crit: 'Carga 340 N·m' },
    { key: 'ocomprimentododormente', name: 'Comprimento do dormente', crit: '2.800 mm (±6)', min: 2794, max: 2806 },
    { key: 'comprimentododormente', name: 'Comprimento do dormente', crit: '2.800 mm (±6)', min: 2794, max: 2806 },
    { key: 'odormmentedeverapossuirbaseretangular', name: 'Base retangular', crit: 'Medida de projeto' },
    { key: 'odormentedeverapossuirbaseretangular', name: 'Base retangular', crit: 'Medida de projeto' },
    { key: 'baseretangularnatesteira', name: 'Base retangular na testeira', crit: '300 mm (±3)', min: 297, max: 303 },
    { key: 'alturadodormentenasecaoentreombreiras', name: 'Altura entre ombreiras', crit: 'Medida de projeto' },
    { key: 'alturadodormentenasecaodaplataforma', name: 'Altura na seção da plataforma', crit: 'Medida de projeto' },
    { key: 'aalturadodormentenasecaodaplataforma', name: 'Altura na seção da plataforma', crit: 'Medida de projeto' },
    { key: 'alturadodormentenasecaodocentro', name: 'Altura na seção do centro', crit: 'Medida de projeto' },
    { key: 'distanciainternaentreombreirasdemesmoapoio', name: 'Dist. interna entre ombreiras (mesmo apoio)', crit: 'Medida de projeto' },
    { key: 'distanciainternaentreombreirasdomesmotrilho', name: 'Dist. interna entre ombreiras do mesmo trilho', crit: 'Medida de projeto' },
    { key: 'distanciainternaentreombreirasexternas', name: 'Dist. interna entre ombreiras externas', crit: 'Medida de projeto' },
    { key: 'verificacaodaalturadaombreira', name: 'Altura da ombreira', kind: 'status', crit: 'Passa / Não passa' },
    // ---- outros modelos iAuditor ----
    { key: 'medidaencontradanareguadebitola', name: 'Medida encontrada na régua de bitola', unit: 'mm', crit: 'Bitola Larga: 1599 a 1602 mm / Bitola Métrica: 999 a 1002 mm' },
    // ---- conclusão ----
    { key: 'loteaprovado', name: 'Lote aprovado?', kind: 'conclusao' },
  ];

  function matchDict(blockNorm) {
    let best = null, bestIdx = Infinity;
    for (const e of DICT) {
      const idx = blockNorm.indexOf(e.key);
      if (idx === -1) continue;
      if (idx < bestIdx || (idx === bestIdx && (!best || e.key.length > best.key.length))) {
        best = e; bestIdx = idx;
      }
    }
    return best;
  }

  /* ---------- metadados conhecidos em vários modelos iAuditor ---------- */
  const META = [
    { keys: ['destino'], label: 'Destino' },
    { keys: ['fiscalresponsavel'], label: 'Fiscal responsável' },
    { keys: ['responsavel', 'preparadopor'], label: 'Responsável' },
    { keys: ['fornecedor'], label: 'Fornecedor' },
    { keys: ['projeto'], label: 'Projeto' },
    { keys: ['tipodedormente'], label: 'Tipo de dormente' },
    { keys: ['comusp', 'usp'], label: 'USP' },
    { keys: ['tipodeombreira'], label: 'Tipo de ombreira' },
    { keys: ['lotedaombreiraeclip', 'lotedaombreira'], label: 'Lote da ombreira' },
    { keys: ['datadoensaio'], label: 'Data do ensaio' },
    { keys: ['datadafabricacaoinspecao'], label: 'Data da fabricação/inspeção' },
    { keys: ['datadafabricacao'], label: 'Data da fabricação' },
    { keys: ['datadeproducaododormente'], label: 'Data de produção' },
    { keys: ['dataprevistadecura'], label: 'Data prevista de cura' },
    { keys: ['lotedodormente', 'lote'], label: 'Lote' },
    { keys: ['molde'], label: 'Molde' },
    { keys: ['cavidade'], label: 'Cavidade' },
    { keys: ['pista'], label: 'Pista' },
    { keys: ['quantidadeproduzida'], label: 'Quantidade produzida' },
    { keys: ['quantidadereprovada'], label: 'Quantidade reprovada' },
    { keys: ['seriedelotes'], label: 'Série de lotes' },
  ];

  function metaLabelFor(text) {
    const n = norm(text);
    for (const m of META) {
      if (m.keys.some((k) => n === k || n.indexOf(k) === 0 || n.indexOf(k) !== -1)) return m.label;
    }
    return null;
  }

  /* ---------- agrupamento por linha/célula ---------- */
  function itemEndX(it) {
    const w = Number(it.w != null ? it.w : it.width);
    if (isFinite(w) && w > 0) return it.x + w;
    return it.x + Math.max(5, String(it.str || '').length * 4.8);
  }

  function groupRows(items, tol) {
    tol = tol || 4;
    const groups = [];
    const sorted = (items || [])
      .filter((it) => it && clean(it.str))
      .map((it) => ({ str: clean(it.str), x: Number(it.x) || 0, top: Number(it.top) || 0, endX: itemEndX(it) }))
      .sort((a, b) => a.top - b.top || a.x - b.x);

    for (const it of sorted) {
      let row = groups.find((g) => Math.abs(g.top - it.top) <= tol);
      if (!row) { row = { top: it.top, items: [] }; groups.push(row); }
      row.items.push(it);
      row.top = (row.top * (row.items.length - 1) + it.top) / row.items.length;
    }

    const rows = groups.sort((a, b) => a.top - b.top).map((row) => {
      const items = row.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null;
      for (const it of items) {
        const gap = cur ? it.x - cur.endX : 0;
        const bigGap = gap > 18;
        if (!cur || bigGap) {
          cur = { x: it.x, endX: it.endX, top: row.top, parts: [it.str] };
          cells.push(cur);
        } else {
          cur.parts.push(it.str);
          cur.endX = Math.max(cur.endX, it.endX);
        }
      }
      cells.forEach((c) => { c.text = clean(c.parts.join(' ')); delete c.parts; });
      const text = clean(cells.map((c) => c.text).join(' '));
      return { top: row.top, x: cells[0] ? cells[0].x : 0, endX: cells[cells.length - 1] ? cells[cells.length - 1].endX : 0, cells, text };
    });
    return rows;
  }

  function rowIsFooterOrNoise(row, pg) {
    if (!row || !clean(row.text)) return true;
    if (isNoise(row.text)) return true;
    if (pg && pg.height && row.top > pg.height - 70) return true;
    const n = norm(row.text);
    if (n === 'foto' || /^foto\d+$/.test(n) || n === 'privateconfidential') return true;
    return false;
  }

  function humanizeSection(text) {
    let s = clean(text)
      .replace(/^\d+\s*[.)-]?\s*/, '')
      .replace(/([a-záéíóúãõç])([A-ZÁÉÍÓÚÃÕÇ])/g, '$1 $2')
      .replace(/([A-Za-zÁÉÍÓÚÃÕÇáéíóúãõç])([0-9])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
    s = s.replace(/^CONCLUSÃO$/i, 'Conclusão');
    return titleCaseSmall(s);
  }

  function isSectionRow(row, pg) {
    if (rowIsFooterOrNoise(row, pg)) return false;
    const t = clean(row.text);
    const n = norm(t);
    if (n.indexOf('resumodemidia') !== -1) return true;
    if (/^\d+\s*\.[A-Za-zÀ-ÿ]/.test(t)) return true;
    if (row.top > 115 && !/(conclus[aã]o|slump|ensaios?\s+de|detalhado|temperatura|informa[cç][oõ]es da concretagem)/i.test(t)) return false;
    if (/(ensaios?\s+de\s+cargas|ensaios?\s+dimensionais|conclus[aã]o|detalhado\s*-|temperatura\s+de\s+lan[cç]amento|slump\s*test|informa[cç][oõ]es\s+da\s+concretagem)/i.test(t)) return true;
    return false;
  }

  function detectHeaders(pages) {
    const headers = [];
    for (const pg of pages) {
      for (const row of pg.rows) {
        if (!isSectionRow(row, pg)) continue;
        const n = norm(row.text);
        if (n.indexOf('resumodemidia') !== -1) {
          headers.push({ page: pg.pageNum, top: row.top, stop: true, title: 'Resumo de mídia' });
          continue;
        }
        const title = humanizeSection(row.text);
        if (!title || /^fotos?$/i.test(title)) continue;
        headers.push({ page: pg.pageNum, top: row.top, title });
      }
    }
    return headers.sort((a, b) => a.page - b.page || a.top - b.top);
  }

  function reportTypeDefault(meta) {
    const n = norm(meta['Tipo de relatório'] || '');
    if (n.indexOf('ensaiodebitola') !== -1) return 'Ensaio de bitola';
    if (n.indexOf('inspecaodepista') !== -1) return 'Inspeção de pista';
    if (n.indexOf('concretagem') !== -1) return 'Concretagem';
    if (n.indexOf('ensaio') !== -1) return 'Ensaios';
    return 'Outros ensaios';
  }

  function sectionAt(headers, meta, page, top) {
    let cur = null;
    for (const h of headers) {
      if (h.stop) continue;
      if (h.page < page || (h.page === page && h.top <= top + 1)) cur = h.title;
    }
    if (cur) return cur;
    if (page > 1) return reportTypeDefault(meta);
    return null;
  }

  function beforeStop(headers, page, top) {
    const stop = headers.find((h) => h.stop);
    return (!stop) || page < stop.page || (page === stop.page && top < stop.top);
  }

  function extractMeta(pages) {
    const meta = {};
    const p1 = pages[0];
    if (!p1) return meta;

    const titleRow = p1.rows.find((r) => !rowIsFooterOrNoise(r, p1) && r.top < 170 && /dormente|concretagem|inspe[cç][aã]o|ensaio/i.test(r.text));
    if (titleRow) meta['Tipo de relatório'] = clean(titleRow.text.replace(/\s*\|\s*/g, ' | '));

    for (const row of p1.rows) {
      if (rowIsFooterOrNoise(row, p1)) continue;
      const cells = row.cells || [];
      if (cells.length < 2) continue;
      const value = clean(cells[cells.length - 1].text);
      const labelTxt = clean(cells.slice(0, -1).map((c) => c.text).join(' '));
      const label = metaLabelFor(labelTxt);
      if (label && value && !meta[label]) meta[label] = value;
    }

    // fallback: rótulo e valor podem estar em linhas/células separadas no mesmo topo.
    for (const row of p1.rows) {
      if (rowIsFooterOrNoise(row, p1)) continue;
      for (let i = 0; i < row.cells.length - 1; i++) {
        const label = metaLabelFor(row.cells[i].text);
        const value = clean(row.cells[row.cells.length - 1].text);
        if (label && value && !meta[label]) meta[label] = value;
      }
    }

    const statusRow = p1.rows.find((r) => /conclu[ií]do/i.test(r.text));
    if (statusRow) meta['Situação do relatório'] = 'Concluído';
    return meta;
  }

  /* ---------- critérios / situação ---------- */
  function parseCriterionRange(text) {
    const t = clean(text).replace(/−/g, '-');
    if (!t) return null;
    let m = t.match(/(-?\d+(?:[.,]\d+)?)\s*a\s*(-?\d+(?:[.,]\d+)?)/i);
    if (m) return { min: toNumber(m[1]), max: toNumber(m[2]) };
    m = t.match(/entre\s*(-?\d+(?:[.,]\d+)?)\s*(?:°?c|mm|kn|%)?\s*a\s*(-?\d+(?:[.,]\d+)?)/i);
    if (m) return { min: toNumber(m[1]), max: toNumber(m[2]) };
    m = t.match(/(-?\d+(?:[.,]\d+)?)\s*\+\s*-\s*(-?\d+(?:[.,]\d+)?)/i) || t.match(/(-?\d+(?:[.,]\d+)?)\s*\+\/[-–]\s*(-?\d+(?:[.,]\d+)?)/i);
    if (m) {
      const base = toNumber(m[1]); const tol = toNumber(m[2]);
      if (base != null && tol != null) return { min: base - tol, max: base + tol };
    }
    m = t.match(/m[aá]x(?:imo|\.)?\s*(?:de\s*)?(-?\d+(?:[.,]\d+)?)/i);
    if (m) return { max: toNumber(m[1]) };
    m = t.match(/m[ií]n(?:imo|\.)?\s*(?:de\s*)?(-?\d+(?:[.,]\d+)?)/i);
    if (m) return { min: toNumber(m[1]) };
    return null;
  }

  function formatValue(v, entry) {
    const status = RE_STATUS.test(clean(v));
    if (status) return clean(v).replace(/^nao$/i, 'Não');
    const n = toNumber(v);
    if (n === null) return clean(v);
    let txt = String(v).trim();
    const num = txt.match(/-?\d+(?:[.,]\d+)?/);
    if (num) txt = txt.replace(num[0], num[0].replace('.', ','));
    if (!hasUnit(v) && entry && entry.unit) txt += ' ' + entry.unit;
    txt = txt.replace(/(\d)\s*(kN|mm|N\.?m|N·m|°C|%)\b/i, '$1 $2');
    return txt.trim();
  }

  function buildRow(name, value, entry, criterionOverride) {
    const row = {
      ensaio: clean(name),
      valor: formatValue(value, entry),
      criterio: criterionOverride || (entry && entry.crit ? entry.crit : '—'),
      situacao: 'info',
      situacaoLabel: 'Medido',
    };
    const nv = norm(value);
    if (entry && entry.kind === 'bool') {
      row.criterio = entry.crit || 'Esperado: Não';
      row.situacao = (nv === 'nao' || nv === 'não') ? 'ok' : 'fail';
      row.situacaoLabel = (row.situacao === 'ok') ? 'Conforme' : 'Atenção';
    } else if (entry && entry.kind === 'status') {
      row.situacao = (nv === 'aprovado' || nv === 'conforme' || nv === 'sim') ? 'ok' : 'fail';
      row.situacaoLabel = clean(value);
    } else if (entry && entry.kind === 'conclusao') {
      row.criterio = '—';
      row.situacao = (nv === 'sim' || nv === 'aprovado') ? 'ok' : 'fail';
      row.situacaoLabel = clean(value);
    } else if (entry && (entry.min != null || entry.max != null)) {
      applyRangeSituation(row, value, { min: entry.min, max: entry.max });
    } else if (criterionOverride) {
      const range = parseCriterionRange(criterionOverride);
      if (range) applyRangeSituation(row, value, range);
    } else if (entry && entry.unit === 'kN') {
      row.situacao = 'info';
      row.situacaoLabel = 'Carga aplicada';
    }
    return row;
  }

  function applyRangeSituation(row, value, range) {
    const n = toNumber(value);
    if (n == null) return;
    const okMin = range.min == null || n >= range.min - 1e-9;
    const okMax = range.max == null || n <= range.max + 1e-9;
    row.situacao = (okMin && okMax) ? 'ok' : 'fail';
    row.situacaoLabel = (okMin && okMax) ? 'Dentro do limite' : 'Fora do limite';
  }

  function extractCriterionNear(pg, row, valueCell) {
    const around = pg.rows.filter((r) => Math.abs(r.top - row.top) <= 18 && r.top >= row.top - 4 && !rowIsFooterOrNoise(r, pg));
    const bits = [];
    for (const r of around) {
      for (const c of r.cells) {
        if (c === valueCell) continue;
        const tx = clean(c.text);
        if (/deve|entre|limite|m[aá]x|m[ií]n|\+\-|\+\/[-–]|\ba\b/i.test(tx) && c.x < valueCell.x + 20) bits.push(tx);
      }
    }
    return clean(bits.join(' '));
  }

  function labelForValue(pg, row, valueCell) {
    const xLimit = Math.min(valueCell.x - 18, pg.width * 0.68);
    const candidates = [];
    for (const r of pg.rows) {
      if (rowIsFooterOrNoise(r, pg)) continue;
      if (isSectionRow(r, pg)) continue;
      if (r.top > row.top + 20) continue;
      const leftText = clean(r.cells.filter((c) => c.endX <= xLimit).map((c) => c.text).join(' '));
      if (!leftText) continue;
      if (/^\d+$/.test(leftText)) continue;
      candidates.push({ top: r.top, text: leftText });
    }
    candidates.sort((a, b) => a.top - b.top);
    if (!candidates.length) return '';

    // Começa pela linha mais próxima do valor e sobe enquanto o bloco for contínuo.
    let idx = candidates.length - 1;
    const chain = [candidates[idx]];
    for (let i = idx - 1; i >= 0; i--) {
      const gap = chain[0].top - candidates[i].top;
      if (gap <= 18) chain.unshift(candidates[i]);
      else break;
    }
    // Também inclui a linha imediatamente abaixo quando a pergunta quebra em duas linhas.
    for (const c of candidates.slice(idx + 1)) {
      if (c.top - chain[chain.length - 1].top <= 18) chain.push(c);
    }
    return clean(chain.map((c) => c.text).join(' '));
  }

  function normalizeGenericName(label, contextPrefix) {
    let name = clean(label);
    name = name.replace(/\s*\([^)]{80,}\)\s*/g, ' ');
    name = clean(name);
    if (contextPrefix && !/^dormente\s*\d+/i.test(name) && /medida encontrada/i.test(name)) {
      name = contextPrefix + ' - ' + name;
    }
    return name;
  }

  function sortSectionTitles(titles) {
    const order = [
      'Ensaios de cargas', 'Ensaios dimensionais', 'Ensaio de bitola',
      'Informações da concretagem Fornecedor', 'Temperatura de Lançamento Rumo',
      'SLUMP TEST Abatimento', 'SLUMP TEST Espalhamento',
      'Detalhado Dormentes Reprovados', 'Detalhado Dormentes Reparados',
      'Conclusão', 'Inspeção de pista', 'Concretagem', 'Outros ensaios'
    ].map(norm);
    return titles.sort((a, b) => {
      const ia = order.indexOf(norm(a));
      const ib = order.indexOf(norm(b));
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }

  function addRow(sections, section, row, dedupe, loc) {
    const key = norm(section) + '|' + norm(row.ensaio) + '|' + norm(row.valor) + '|' + (loc || '');
    if (dedupe.has(key)) return false;
    dedupe.add(key);
    (sections[section] = sections[section] || []).push(row);
    return true;
  }

  /* ---------- tabelas Slump Test ---------- */
  function parseSlumpTable(pg, section, sections, dedupe) {
    const sn = norm(section);
    if (sn.indexOf('slumptest') === -1) return false;
    const base = sn.indexOf('espalhamento') !== -1 ? 'ESPALHAMENTO' : 'ABATIMENTO';
    const baseNorm = norm(base);
    const header = pg.rows.find((r) => r.cells.filter((c) => norm(c.text).indexOf(baseNorm) !== -1).length >= 2);
    if (!header) return false;
    const cols = header.cells.filter((c) => norm(c.text).indexOf(baseNorm) !== -1).map((c) => ({ x: c.x, title: base }));
    if (!cols.length) return false;

    for (const col of cols) {
      const below = pg.rows.filter((r) => r.top > header.top && r.top < header.top + 65);
      const critCell = nearestCell(below, col.x, (txt) => /\(|\+\-|\ba\b|mm/i.test(txt));
      const posCell = nearestCell(below, col.x, (txt) => /pista/i.test(txt));
      col.criterion = critCell ? critCell.text : '';
      col.position = posCell ? posCell.text : '';
    }

    const dataRows = pg.rows.filter((r) => r.top > header.top + 35 && r.top < pg.height - 80 && r.cells.some((c) => isValueToken(c.text) && /mm/i.test(c.text)));
    let added = false;
    for (const dr of dataRows) {
      for (const col of cols) {
        const vc = nearestCell([dr], col.x, (txt) => isValueToken(txt) && /mm/i.test(txt));
        if (!vc) continue;
        const name = clean(base + (col.position ? ' - ' + col.position : ''));
        const row = buildRow(name, vc.text, null, col.criterion || '—');
        added = addRow(sections, section, row, dedupe, pg.pageNum + ':' + Math.round(dr.top) + ':' + Math.round(col.x)) || added;
      }
    }
    return added;
  }

  function nearestCell(rows, x, pred) {
    let best = null, bestDist = Infinity;
    for (const r of rows) {
      for (const c of r.cells) {
        if (pred && !pred(c.text)) continue;
        const d = Math.abs(c.x - x);
        if (d < bestDist && d < 55) { best = c; bestDist = d; }
      }
    }
    return best;
  }

  /* ---------- parser principal ---------- */
  function parse(pagesRaw) {
    const pages = (pagesRaw || []).map((pg) => ({
      pageNum: pg.pageNum,
      width: pg.width || 595,
      height: pg.height || 842,
      rows: groupRows((pg.items || []).filter((it) => !isNoise(it.str)), 4),
    }));

    const meta = extractMeta(pages);
    const headers = detectHeaders(pages);
    const sections = {};
    const dedupe = new Set();
    let conclusao = null;
    let bitolaContext = '';

    for (const pg of pages) {
      for (const row of pg.rows) {
        if (!beforeStop(headers, pg.pageNum, row.top)) continue;
        if (rowIsFooterOrNoise(row, pg) || isSectionRow(row, pg)) continue;
        const section = sectionAt(headers, meta, pg.pageNum, row.top);
        if (!section) continue;

        // Tabelas transversais de Slump: cabeçalho em colunas e valores em uma linha.
        if (norm(section).indexOf('slumptest') !== -1) {
          parseSlumpTable(pg, section, sections, dedupe);
          continue;
        }

        const valueCells = row.cells.filter((c, idx) => {
          const isRight = c.x > pg.width * 0.42 || idx === row.cells.length - 1;
          if (!isRight) return false;
          if (!isValueToken(c.text)) return false;
          if (/^\d+$/.test(c.text) && c.x < pg.width * 0.35) return false;
          return true;
        });

        for (const valueCell of valueCells) {
          const sameLineLabel = clean(row.cells.filter((c) => c.endX < valueCell.x - 18).map((c) => c.text).join(' '));
          const blockLabel = labelForValue(pg, row, valueCell);
          let label = blockLabel || sameLineLabel;
          if (sameLineLabel && blockLabel && norm(blockLabel).indexOf(norm(sameLineLabel)) === -1 && sameLineLabel.length > blockLabel.length) label = sameLineLabel;
          label = clean(label);
          if (!label || isNoise(label)) continue;
          if (/^resultado$|^a[cç][oõ]es$|^elementos sinalizados$/i.test(label)) continue;

          const dm = label.match(/^(Dormente\s*\d+)/i);
          if (dm) bitolaContext = clean(dm[1].replace(/\s+/, ' '));
          const labelWithContext = normalizeGenericName(label, bitolaContext);
          const entry = matchDict(norm(labelWithContext));
          const criterion = extractCriterionNear(pg, row, valueCell);
          let name = entry ? entry.name : labelWithContext;
          if (entry && entry.key === 'medidaencontradanareguadebitola' && bitolaContext) name = bitolaContext + ' - ' + entry.name;
          const rowObj = buildRow(name, valueCell.text, entry, criterion || undefined);

          if (entry && entry.kind === 'conclusao') {
            conclusao = rowObj;
          } else {
            addRow(sections, section, rowObj, dedupe, pg.pageNum + ':' + Math.round(row.top) + ':' + Math.round(valueCell.x));
          }
        }
      }
    }

    const sectionList = sortSectionTitles(Object.keys(sections))
      .map((title) => ({ title, rows: sections[title] }));

    return { meta, sections: sectionList, conclusao };
  }

  return { parse, _internals: { norm, isValueToken, matchDict, groupRows } };
});
