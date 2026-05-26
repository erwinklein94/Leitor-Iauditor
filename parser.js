/* =====================================================================
   RUMO · Leitor de Relatórios de Ensaio de Dormente (iAuditor)
   parser.js — lógica de extração pura (sem DOM, testável em Node)

   Entrada esperada: lista de páginas no formato
     [{ pageNum, width, height, items: [{ str, x, top }] }]
   onde x = posição horizontal (px, origem à esquerda)
         top = posição vertical (px, origem no topo da página)

   A detecção é POSICIONAL e independente do lote/fornecedor/data:
     · rótulos do ensaio ficam na coluna da esquerda;
     · o valor (carga ou medida) fica na coluna da direita,
       alinhado pelo topo ao bloco do ensaio.
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

  const RE_NUM = /^-?\d{1,6}([.,]\d+)?$/;
  const RE_NUM_UNIT = /^-?\d{1,6}([.,]\d+)?(kn|mm|nm|n|%)$/i;
  const RE_STATUS = /^(aprovado|reprovado|sim|nao|conforme|naoconforme)$/;
  const RE_NOISE = [
    /^foto\s*\d+$/i,            // legendas de foto
    /^\d+\s*\/\s*\d+$/,         // numeração de página  (12/29)
  ];

  function isNoise(str) {
    const c = compact(str);
    if (!c) return true;
    if (RE_NOISE.some((r) => r.test(str.trim()))) return true;
    // rodapé do relatório: "FERRONORTE / 2824 / Cavan - SP / .../ Erwin Klein"
    if (/ferronorte\/?\d{2,}\/?/i.test(c) && /\/.*\//.test(str)) return true;
    return false;
  }

  function isValueToken(str) {
    const c = compact(str);
    return RE_NUM.test(c) || RE_NUM_UNIT.test(c) || RE_STATUS.test(norm(c));
  }

  /* ---------- dicionário do modelo "Dormente de Concreto" ---------- */
  /* key = trecho normalizado procurado no texto do bloco
     A atribuição usa a MAIOR key que for substring do bloco (desambigua
     ensaio x pergunta "apresentou fissuras"). */
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
    { key: 'aderenciaescorregamento', name: 'Aderência — escorregamento do aço', crit: 'Máx. 0,025 mm', max: 0.025 },
    { key: 'ensaiodearrancamentonaombreiraa', name: 'Arrancamento na ombreira A', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'ensaiodearrancamentonaombreirab', name: 'Arrancamento na ombreira B', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'arrancamentonaombreiraa', name: 'Arrancamento na ombreira A', unit: 'kN', crit: 'Carga 53,40 kN' },
    { key: 'arrancamentonaombreirab', name: 'Arrancamento na ombreira B', unit: 'kN', crit: 'Carga 53,40 kN' },
    // ---- dimensionais ----
    { key: 'inclinacaodabasedeapoiodostrilhos', name: 'Inclinação da base de apoio dos trilhos', crit: 'Entre 4,545 e 5,556', min: 4.545, max: 5.556 },
    { key: 'empenotransversal', name: 'Empeno transversal (torção) entre apoios', crit: 'Máx. 1 mm', max: 1 },
    { key: 'ensaiodetorcaonaombreiraa', name: 'Torção na ombreira A', kind: 'status', crit: 'Carga 340 N·m' },
    { key: 'ensaiodetorcaonaombreirab', name: 'Torção na ombreira B', kind: 'status', crit: 'Carga 340 N·m' },
    { key: 'ocomprimentododormente', name: 'Comprimento do dormente', crit: '2.800 mm (±6)', min: 2794, max: 2806 },
    { key: 'baseretangularnatesteira', name: 'Base retangular na testeira', crit: '300 mm (±3)', min: 297, max: 303 },
    { key: 'alturadodormentenasecaoentreombreiras', name: 'Altura entre ombreiras', crit: '250 mm (+6/−3)', min: 247, max: 256 },
    { key: 'alturadodormentenasecaodocentro', name: 'Altura na seção do centro', crit: '220 mm (+6/−3)', min: 217, max: 226 },
    { key: 'distanciainternaentreombreirasdemesmoapoio', name: 'Dist. interna entre ombreiras (mesmo apoio)', crit: '154,50 mm (+1,5/−0,5)', min: 154.0, max: 156.0 },
    { key: 'distanciainternaentreombreirasexternas', name: 'Dist. interna entre ombreiras externas', kind: 'status', crit: 'Passa / Não passa' },
    { key: 'verificacaodaalturadaombreira', name: 'Altura da ombreira', kind: 'status', crit: 'Passa / Não passa' },
    // ---- conclusão ----
    { key: 'loteaprovado', name: 'Lote aprovado?', kind: 'conclusao' },
  ];

  function matchDict(blockNorm) {
    let best = null, bestIdx = Infinity;
    for (const e of DICT) {
      const idx = blockNorm.indexOf(e.key);
      if (idx === -1) continue;
      // título lidera o bloco => menor índice vence; empate => maior key
      if (idx < bestIdx || (idx === bestIdx && (!best || e.key.length > best.key.length))) {
        best = e; bestIdx = idx;
      }
    }
    return best;
  }

  const SECTIONS = [
    { key: 'ensaiosdecargas', title: 'Ensaios de cargas' },
    { key: 'ensaiosdimensionais', title: 'Ensaios dimensionais' },
    { key: 'conclusao', title: 'Conclusão' },
  ];
  const STOP_KEY = 'resumodemidia';

  const META = [
    { key: 'destino', label: 'Destino' },
    { key: 'fiscalresponsavel', label: 'Fiscal responsável' },
    { key: 'fornecedor', label: 'Fornecedor' },
    { key: 'tipodedormente', label: 'Tipo de dormente' },
    { key: 'datadoensaio', label: 'Data do ensaio' },
    { key: 'datadeproducaododormente', label: 'Data de produção' },
    { key: 'lote', label: 'Lote' },
    { key: 'molde', label: 'Molde' },
    { key: 'cavidade', label: 'Cavidade' },
    { key: 'pista', label: 'Pista' },
    { key: 'seriedelotes', label: 'Série de lotes' },
  ];

  /* ---------- agrupamento em linhas ---------- */
  function groupLines(items, tol) {
    tol = tol || 4;
    const lines = [];
    const sorted = items.slice().sort((a, b) => a.top - b.top || a.x - b.x);
    for (const it of sorted) {
      const ln = lines.find((l) => Math.abs(l.top - it.top) <= tol);
      if (ln) { ln.items.push(it); ln.top = (ln.top + it.top) / 2; }
      else lines.push({ top: it.top, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.text = clean(l.items.map((i) => i.str).join(' '));
      l.x = l.items[0].x;
    }
    return lines.sort((a, b) => a.top - b.top);
  }

  /* ---------- parser principal ---------- */
  function parse(pagesRaw) {
    const pages = [];
    for (const pg of pagesRaw) {
      const W = pg.width || 595;
      const left = [], right = [];
      for (const it of pg.items) {
        if (isNoise(it.str)) continue;
        (it.x >= 0.5 * W ? right : left).push(it);
      }
      pages.push({
        pageNum: pg.pageNum, width: W,
        leftLines: groupLines(left, 4),
        rightLines: groupLines(right, 4),
      });
    }

    /* --- metadados (1ª página) --- */
    const meta = {};
    const p1 = pages[0];
    if (p1) {
      for (const m of META) {
        const ln = p1.leftLines.find((l) => norm(l.text).indexOf(m.key) === 0)
          || p1.leftLines.find((l) => norm(l.text).indexOf(m.key) !== -1);
        if (!ln) continue;
        const vals = p1.rightLines
          .filter((r) => r.top >= ln.top - 12 && r.top <= ln.top + 18)
          .sort((a, b) => a.top - b.top)
          .map((r) => r.text);
        if (vals.length) meta[m.label] = clean(vals.join(' '));
      }
      const concl = p1.rightLines.find((r) => /conclu/i.test(r.text));
      if (concl) {
        const m = concl.text.match(/conclu\S*/i);
        meta['Situação do relatório'] = m ? m[0] : 'Concluído';
      }
    }

    /* --- cabeçalhos de seção (página, top) em ordem do documento --- */
    const headers = [];
    pages.forEach((pg) => {
      pg.leftLines.forEach((l) => {
        const n = norm(l.text);
        if (n.indexOf(STOP_KEY) !== -1) headers.push({ page: pg.pageNum, top: l.top, stop: true });
        SECTIONS.forEach((s) => {
          if (n.indexOf(s.key) !== -1) headers.push({ page: pg.pageNum, top: l.top, title: s.title });
        });
      });
    });
    const stop = headers.find((h) => h.stop);
    const before = (page, top) => (!stop) || (page < stop.page) || (page === stop.page && top < stop.top);
    function sectionAt(page, top) {
      let cur = null;
      for (const h of headers) {
        if (h.stop) continue;
        if (h.page < page || (h.page === page && h.top <= top + 1)) cur = h.title;
      }
      return cur;
    }

    /* --- localizar título do bloco acima de cada valor --- */
    function blockFor(pg, vtop) {
      const cands = pg.leftLines.filter((l) => l.top <= vtop + 14).sort((a, b) => a.top - b.top);
      if (!cands.length) return null;
      const chain = [cands[cands.length - 1]];
      for (let i = cands.length - 2; i >= 0; i--) {
        if (chain[0].top - cands[i].top <= 16) chain.unshift(cands[i]);
        else break;
      }
      return { title: chain[0].text, blockNorm: norm(chain.map((c) => c.text).join(' ')) };
    }

    /* --- coletar valores (coluna direita) na ordem do documento --- */
    const rawRows = [];
    pages.forEach((pg) => {
      pg.rightLines.forEach((r) => {
        if (!before(pg.pageNum, r.top)) return;
        if (!isValueToken(r.text)) return;
        const blk = blockFor(pg, r.top);
        if (!blk) return;
        rawRows.push({ page: pg.pageNum, top: r.top, value: clean(r.text), block: blk });
      });
    });
    rawRows.sort((a, b) => a.page - b.page || a.top - b.top);

    /* --- montar linhas finais --- */
    const sections = {};
    let conclusao = null;
    const seen = new Set();
    for (const rr of rawRows) {
      const sect = sectionAt(rr.page, rr.top);
      if (!sect) continue; // valores da capa/metadados não são ensaios
      const entry = matchDict(rr.block.blockNorm);
      const name = entry ? entry.name : (clean(rr.block.title) || '(sem rótulo)');
      const dedupe = sect + '|' + name + '|' + rr.value;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const row = buildRow(name, rr.value, entry);
      if (entry && entry.kind === 'conclusao') { conclusao = row; continue; }
      (sections[sect] = sections[sect] || []).push(row);
    }

    const order = ['Ensaios de cargas', 'Ensaios dimensionais', 'Conclusão', 'Outros ensaios'];
    const sectionList = Object.keys(sections)
      .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      .map((title) => ({ title, rows: sections[title] }));

    return { meta, sections: sectionList, conclusao };
  }

  /* ---------- formatação de uma linha (valor + critério + situação) ---------- */
  function toNumber(v) {
    const m = String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = parseFloat(m);
    return isNaN(n) ? null : n;
  }
  function hasUnit(v) { return /[a-zA-Z]/.test(v); }
  function formatValue(v, entry) {
    const n = toNumber(v);
    const status = RE_STATUS.test(norm(v));
    if (status) return clean(v);
    if (n === null) return clean(v);
    let out = String(v).trim();
    // dot decimal -> comma (pt-BR), mantém unidade se já houver
    out = out.replace(/(\d),(?=\d)/g, '$1.'); // normaliza primeiro
    let txt = out;
    const num = txt.match(/-?\d+(\.\d+)?/);
    if (num) {
      const ptbr = num[0].replace('.', ',');
      txt = txt.replace(num[0], ptbr);
    }
    if (!hasUnit(v) && entry && entry.unit) txt += ' ' + entry.unit;
    txt = txt.replace(/(\d)\s*(kN|mm|N·?m|%)\b/i, '$1 $2'); // espaço antes da unidade
    return txt.trim();
  }
  function buildRow(name, value, entry) {
    const row = {
      ensaio: name,
      valor: formatValue(value, entry),
      criterio: entry && entry.crit ? entry.crit : '—',
      situacao: 'info',
      situacaoLabel: 'Medido',
    };
    const nv = norm(value);
    if (entry && entry.kind === 'bool') {
      // pergunta "apresentou fissuras?": esperado = Não
      row.criterio = entry.crit || 'Esperado: Não';
      row.situacao = (nv === 'nao') ? 'ok' : 'fail';
      row.situacaoLabel = (nv === 'nao') ? 'Conforme' : 'Atenção';
    } else if (entry && entry.kind === 'status') {
      row.situacao = (nv === 'aprovado' || nv === 'conforme') ? 'ok' : 'fail';
      row.situacaoLabel = clean(value);
    } else if (entry && entry.kind === 'conclusao') {
      row.criterio = '—';
      row.situacao = (nv === 'sim' || nv === 'aprovado') ? 'ok' : 'fail';
      row.situacaoLabel = clean(value);
    } else if (entry && (entry.min != null || entry.max != null)) {
      const n = toNumber(value);
      if (n != null) {
        const okMin = entry.min == null || n >= entry.min - 1e-9;
        const okMax = entry.max == null || n <= entry.max + 1e-9;
        row.situacao = (okMin && okMax) ? 'ok' : 'fail';
        row.situacaoLabel = (okMin && okMax) ? 'Dentro do limite' : 'Fora do limite';
      }
    } else if (entry && entry.unit === 'kN') {
      row.situacao = 'info';
      row.situacaoLabel = 'Carga aplicada';
    }
    return row;
  }

  return { parse, _internals: { norm, isValueToken, matchDict } };
});
