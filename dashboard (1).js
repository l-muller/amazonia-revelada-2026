/* ============================================================
   dashboard.js — Painel de Métricas | Amazônia Revelada
   ------------------------------------------------------------
   Módulo independente. Todo o cálculo geoespacial (Turf.js) e a
   interface do painel vivem aqui — nada disso está no index.html.

   Como usar no index.html:
     1) Incluir, em <head>, ANTES ou DEPOIS do script principal
        (a ordem não importa, tudo roda dentro de "load"):
          <script src="https://unpkg.com/@turf/turf@6/turf.min.js"></script>
          <script src="https://unpkg.com/chart.js@4.4.0/dist/chart.umd.min.js"></script>
          <script src="dashboard.js"></script>

     2) Depois que as camadas terminarem de carregar (dentro do
        .then() do Promise.all do index.html), chamar:

          window.iniciarDashboard({
            planoVoo, cnfp, ti, sicar,      // GeoJSON brutos (não a layer do Leaflet)
            entregas: [
              { nome: "Entrega 01", geojson: entrega01, cor: coresEntregas.entrega01.stroke },
              ...
            ],
            coresCNFP,       // mesmo objeto já usado no index.html
            coresBlocos,     // idem
            sicarCorBase,    // idem
            getFiltrosSicarAtivos: () => ({
              tipos: Array.from(tiposAtivos),
              status: Array.from(statusAtivos)
            })
          })

   O módulo cria sozinho um botão flutuante ("📊") e o painel —
   nenhum HTML/CSS precisa existir de antemão no index.html.
   ============================================================ */

(function () {
  "use strict";

  let CONFIG = null;
  let jaCalculado = false;
  const graficos = {}; // guarda instâncias Chart.js para destruir/recriar sem vazar memória

  // ---------------------------------------------------------
  // CSS do painel (injetado via JS — dashboard.js é autocontido)
  // ---------------------------------------------------------
  function injetarEstilos() {
    if (document.getElementById("dash-estilos")) return; // evita duplicar se chamado 2x
    const css = `
      #dash-btn {
        position: absolute; top: 120px; left: 10px; z-index: 1000;
        background: rgba(10,14,20,0.9); border: 1px solid rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.75); width: 30px; height: 30px; border-radius: 4px;
        font-size: 15px; cursor: pointer; line-height: 30px; text-align: center; padding: 0;
      }
      #dash-btn:hover { background: rgba(99,179,237,0.2); color: #fff; }

      #dash-overlay {
        display: none; position: absolute; inset: 0; z-index: 2500;
        background: rgba(5,8,12,0.55); backdrop-filter: blur(2px);
      }
      #dash-overlay.aberto { display: block; }

      #dash-painel {
        position: absolute; top: 24px; right: 24px; bottom: 24px; left: 24px;
        max-width: 980px; margin: 0 auto;
        background: rgba(10,14,20,0.97); border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: 'Segoe UI', system-ui, sans-serif; color: #fff;
      }

      #dash-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 22px; border-bottom: 1px solid rgba(255,255,255,0.07); flex-shrink: 0;
      }
      #dash-header .projeto {
        font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
        color: rgba(255,255,255,0.35); margin-bottom: 2px;
      }
      #dash-header h2 { font-size: 15px; font-weight: 600; }
      #dash-fechar, #dash-recalcular {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.7); border-radius: 6px; padding: 6px 12px;
        font-size: 11px; cursor: pointer; margin-left: 8px;
      }
      #dash-fechar:hover, #dash-recalcular:hover { background: rgba(255,255,255,0.14); color: #fff; }

      #dash-corpo { flex: 1; overflow-y: auto; padding: 20px 22px 28px; position: relative; }

      .dash-secao { margin-bottom: 26px; }
      .dash-secao-titulo {
        font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
        color: rgba(255,255,255,0.35); margin-bottom: 10px;
      }

      .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }

      .dash-card {
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px; padding: 14px 16px;
      }
      .dash-card .rotulo { font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 6px; }
      .dash-card .valor { font-size: 22px; font-weight: 700; }
      .dash-card .sub { font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 4px; line-height: 1.5; }

      .dash-barra-fundo {
        width: 100%; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08);
        margin-top: 10px; overflow: hidden;
      }
      .dash-barra-preenchida { height: 100%; border-radius: 4px; transition: width 0.6s ease; }

      .dash-chart-wrap { position: relative; height: 220px; }
      .dash-chart-wrap.pequeno { height: 170px; }

      .dash-nota { font-size: 10px; color: rgba(255,255,255,0.35); line-height: 1.6; margin-bottom: 10px; }

      .dash-legenda-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .dash-legenda-cor { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
      .dash-legenda-label { font-size: 10px; color: rgba(255,255,255,0.55); letter-spacing: 0.3px; }

      #dash-loading {
        position: absolute; inset: 0; z-index: 10; display: none; flex-direction: column;
        align-items: center; justify-content: center; gap: 10px; background: rgba(10,14,20,0.85);
        font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.6);
      }
      #dash-loading .spin {
        width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.1);
        border-top-color: #63b3ed; animation: dash-girar 0.8s linear infinite;
      }
      @keyframes dash-girar { to { transform: rotate(360deg); } }
      #dash-loading .progresso-texto { font-size: 10px; color: rgba(255,255,255,0.4); }

      @media (max-width: 720px) {
        #dash-painel { top: 8px; right: 8px; bottom: 8px; left: 8px; }
        #dash-corpo { padding: 14px; }
      }
    `;
    const style = document.createElement("style");
    style.id = "dash-estilos";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------
  // DOM: botão flutuante + painel (overlay)
  // ---------------------------------------------------------
  function montarDOM() {
    if (document.getElementById("dash-btn")) return; // evita duplicar

    const btn = document.createElement("button");
    btn.id = "dash-btn";
    btn.title = "Métricas e Indicadores";
    btn.textContent = "📊";
    btn.addEventListener("click", abrirPainel);
    document.body.appendChild(btn);

    const overlay = document.createElement("div");
    overlay.id = "dash-overlay";
    overlay.innerHTML = `
      <div id="dash-painel">
        <div id="dash-header">
          <div>
            <div class="projeto">Amazônia Revelada</div>
            <h2>Métricas &amp; Indicadores Espaciais</h2>
          </div>
          <div>
            <button id="dash-recalcular">↻ Recalcular</button>
            <button id="dash-fechar">✕ Fechar</button>
          </div>
        </div>
        <div id="dash-corpo">
          <div id="dash-loading">
            <div class="spin"></div>
            <div>Calculando métricas…</div>
            <div class="progresso-texto" id="dash-loading-progresso"></div>
          </div>
          <div id="dash-conteudo"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) fecharPainel(); });
    document.getElementById("dash-fechar").addEventListener("click", fecharPainel);
    document.getElementById("dash-recalcular").addEventListener("click", () => rodarCalculos(true));
  }

  function abrirPainel() {
    document.getElementById("dash-overlay").classList.add("aberto");
    if (!jaCalculado) rodarCalculos();
  }
  function fecharPainel() {
    document.getElementById("dash-overlay").classList.remove("aberto");
  }

  // ---------------------------------------------------------
  // Helpers geoespaciais (Turf.js)
  // ---------------------------------------------------------
  function bboxDe(geojson) {
    try { return turf.bbox(geojson); } catch (e) { return null; }
  }
  function bboxSeSobrepoe(a, b) {
    if (!a || !b) return false;
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }
  function areaKm2(geojson) {
    try { return (turf.area(geojson) || 0) / 1_000_000; } catch (e) { return 0; }
  }
  function interseccaoAreaM2(featA, featB) {
    try {
      const inter = turf.intersect(featA, featB);
      return inter ? turf.area(inter) : 0;
    } catch (e) {
      return 0; // par de geometrias problemático (auto-interseção etc.) — ignora e segue
    }
  }
  // Une uma lista PEQUENA de polígonos (ex.: os 4 blocos) numa só geometria.
  // Não usar com centenas/milhares de feições — o custo cresce rápido.
  function unirFeatures(features) {
    const validos = (features || []).filter(f => f && f.geometry);
    if (validos.length === 0) return null;
    let acc = validos[0];
    for (let i = 1; i < validos.length; i++) {
      try { acc = turf.union(acc, validos[i]) || acc; } catch (e) { /* ignora par problemático */ }
    }
    return acc;
  }
  // Processa uma lista em lotes, cedendo a thread entre eles (setTimeout 0)
  // para a interface não travar com camadas grandes (ex.: SICAR).
  function processarEmLotes(lista, tamanhoLote, funcaoPorItem, aoTerminar) {
    let i = 0;
    function proximoLote() {
      const fim = Math.min(i + tamanhoLote, lista.length);
      for (; i < fim; i++) funcaoPorItem(lista[i]);
      if (i < lista.length) setTimeout(proximoLote, 0);
      else aoTerminar();
    }
    if (!lista || lista.length === 0) { aoTerminar(); return; }
    proximoLote();
  }

  // ---------------------------------------------------------
  // Cálculo principal
  // ---------------------------------------------------------
  function rodarCalculos(forcar) {
    if (jaCalculado && !forcar) return;
    const loading = document.getElementById("dash-loading");
    const progressoTxt = document.getElementById("dash-loading-progresso");
    loading.style.display = "flex";

    // adia 1 tick pra o spinner aparecer antes da thread ocupar com os cálculos
    setTimeout(() => {
      const resultado = {};

      const blocosFeatures = (CONFIG.planoVoo && CONFIG.planoVoo.features) || [];
      const blocoUnido = unirFeatures(blocosFeatures);
      const bboxVoo = bboxDe(CONFIG.planoVoo);
      const areaVooTotalKm2 = areaKm2(CONFIG.planoVoo);

      // --- Progresso geral: soma bruta da área de todas as entregas ---
      let areaEntregasTotalKm2 = 0;
      const areaPorEntrega = [];
      (CONFIG.entregas || []).forEach(e => {
        const a = areaKm2(e.geojson);
        areaEntregasTotalKm2 += a;
        areaPorEntrega.push({ nome: e.nome, cor: e.cor, areaKm2: a });
      });
      resultado.progressoGeral = {
        executadoKm2: areaEntregasTotalKm2,
        planejadoKm2: areaVooTotalKm2,
        percentual: areaVooTotalKm2 > 0 ? Math.min(100, (areaEntregasTotalKm2 / areaVooTotalKm2) * 100) : 0
      };
      resultado.porEntrega = areaPorEntrega;

      // --- Progresso por bloco: interseção de cada retalho de entrega com cada bloco ---
      const progressoPorBloco = blocosFeatures.map(b => ({
        id: (b.properties && (b.properties.id || b.properties.ID)) || "?",
        areaTotalKm2: areaKm2(b),
        areaExecutadaM2: 0,
        bbox: bboxDe(b),
        feature: b
      }));

      const todasTiles = [];
      (CONFIG.entregas || []).forEach(e => {
        (e.geojson.features || []).forEach(f => todasTiles.push(f));
      });

      const cnfpFeatures   = (CONFIG.cnfp  && CONFIG.cnfp.features)  || [];
      const tiFeatures     = (CONFIG.ti    && CONFIG.ti.features)    || [];
      const sicarFeatures  = (CONFIG.sicar && CONFIG.sicar.features) || [];

      // pré-calcula os bbox de cada TI uma única vez (o loop de tiles roda para cada retalho de entrega,
      // então evitar recalcular bbox(f) a cada iteração importa bastante em datasets grandes)
      const tiComBbox = tiFeatures.map(f => ({ feature: f, bbox: bboxDe(f) }));
      const tiBboxGlobal = bboxDe(CONFIG.ti);

      const filtrosCnfp = (CONFIG.getFiltrosCnfpAtivos && CONFIG.getFiltrosCnfpAtivos()) ||
        ["SEM DESTINACAO", "USO SUSTENTAVEL", "PROTECAO INTEGRAL", "USO MILITAR"];

      const filtrosSicar = (CONFIG.getFiltrosSicarAtivos && CONFIG.getFiltrosSicarAtivos()) ||
        { tipos: ["IRU", "AST", "PCT"], status: ["AT", "PE", "SU", "CA"] };

      const cnfpPorCategoria = {};
      let tiAreaM2 = 0;
      let tiExecutadoM2 = 0; // quanto da área de TI já foi sobrevoado (entregas ∩ TI)
      const sicarPorTipo = {};

      const totalPasso = todasTiles.length + cnfpFeatures.length + tiFeatures.length + sicarFeatures.length;
      let feito = 0;
      function marcarProgresso() {
        feito++;
        if (progressoTxt && totalPasso) progressoTxt.textContent = Math.round((feito / totalPasso) * 100) + "%";
      }

      // Etapa 1 — progresso por bloco + sobreposição de TI já sobrevoada
      processarEmLotes(todasTiles, 200, (tile) => {
        const bboxTile = bboxDe(tile);
        progressoPorBloco.forEach(pb => {
          if (bboxSeSobrepoe(bboxTile, pb.bbox)) {
            pb.areaExecutadaM2 += interseccaoAreaM2(tile, pb.feature);
          }
        });
        if (tiBboxGlobal && bboxSeSobrepoe(bboxTile, tiBboxGlobal)) {
          tiComBbox.forEach(t => {
            if (bboxSeSobrepoe(bboxTile, t.bbox)) {
              tiExecutadoM2 += interseccaoAreaM2(tile, t.feature);
            }
          });
        }
        marcarProgresso();
      }, etapaCnfp);

      function etapaCnfp() {
        processarEmLotes(cnfpFeatures, 100, (feat) => {
          marcarProgresso();
          const cat = ((feat.properties && feat.properties.protecao) || "OUTROS").toUpperCase().trim();
          if (!filtrosCnfp.includes(cat)) return;
          if (!blocoUnido) return;
          const bboxF = bboxDe(feat);
          if (!bboxSeSobrepoe(bboxF, bboxVoo)) return;
          cnfpPorCategoria[cat] = (cnfpPorCategoria[cat] || 0) + interseccaoAreaM2(blocoUnido, feat);
        }, etapaTi);
      }

      function etapaTi() {
        processarEmLotes(tiFeatures, 100, (feat) => {
          marcarProgresso();
          if (!blocoUnido) return;
          const bboxF = bboxDe(feat);
          if (!bboxSeSobrepoe(bboxF, bboxVoo)) return;
          tiAreaM2 += interseccaoAreaM2(blocoUnido, feat);
        }, etapaSicar);
      }

      function etapaSicar() {
        processarEmLotes(sicarFeatures, 300, (feat) => {
          marcarProgresso();
          const p = feat.properties || {};
          const tipo = (p.ind_tipo || "").trim();
          const status = (p.ind_status || "").trim();
          if (!filtrosSicar.tipos.includes(tipo) || !filtrosSicar.status.includes(status)) return;
          if (!blocoUnido) return;
          const bboxF = bboxDe(feat);
          if (!bboxSeSobrepoe(bboxF, bboxVoo)) return;
          sicarPorTipo[tipo] = (sicarPorTipo[tipo] || 0) + interseccaoAreaM2(blocoUnido, feat);
        }, finalizar);
      }

      function finalizar() {
        resultado.porBloco = progressoPorBloco.map(pb => ({
          id: pb.id,
          areaTotalKm2: pb.areaTotalKm2,
          areaExecutadaKm2: pb.areaExecutadaM2 / 1_000_000,
          percentual: pb.areaTotalKm2 > 0 ? Math.min(100, (pb.areaExecutadaM2 / 1_000_000 / pb.areaTotalKm2) * 100) : 0
        }));
        resultado.cnfp = {
          categorias: Object.entries(cnfpPorCategoria).map(([categoria, m2]) => ({ categoria, areaKm2: m2 / 1_000_000 })),
          filtrosAtivos: filtrosCnfp
        };
        resultado.ti = {
          areaKm2: tiAreaM2 / 1_000_000,
          percentual: areaVooTotalKm2 > 0 ? (tiAreaM2 / 1_000_000 / areaVooTotalKm2 * 100) : 0,
          executadoKm2: tiExecutadoM2 / 1_000_000,
          percentualExecutado: (tiAreaM2 / 1_000_000) > 0 ? Math.min(100, (tiExecutadoM2 / tiAreaM2) * 100) : 0
        };
        resultado.sicar = {
          porTipo: Object.entries(sicarPorTipo).map(([tipo, m2]) => ({ tipo, areaKm2: m2 / 1_000_000 })),
          filtrosAtivos: filtrosSicar
        };

        jaCalculado = true;
        loading.style.display = "none";
        renderizar(resultado);
      }
    }, 30);
  }

  // ---------------------------------------------------------
  // Renderização: HTML + gráficos Chart.js
  // ---------------------------------------------------------
  function opcoesBarraHorizontal() {
    return {
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "rgba(255,255,255,0.5)" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "rgba(255,255,255,0.6)" }, grid: { display: false } }
      }
    };
  }

  function renderizar(r) {
    const cont = document.getElementById("dash-conteudo");
    const coresCNFP    = CONFIG.coresCNFP    || {};
    const coresBlocos  = CONFIG.coresBlocos  || {};
    const sicarCorBase = CONFIG.sicarCorBase || { IRU: { stroke: "#ef4444" }, AST: { stroke: "#f97316" }, PCT: { stroke: "#eab308" } };

    const avisoChartAusente = typeof Chart === "undefined"
      ? `<div class="dash-nota" style="color:#fca5a5;margin-bottom:14px">
           ⚠ A biblioteca de gráficos (Chart.js) não carregou — os números abaixo estão corretos,
           mas os gráficos não vão aparecer. Confira sua conexão ou o Console (F12) para mais detalhes.
         </div>` : "";

    cont.innerHTML = `
      ${avisoChartAusente}
      <div class="dash-secao">
        <div class="dash-secao-titulo">Progresso Geral</div>
        <div class="dash-grid">
          <div class="dash-card">
            <div class="rotulo">Área planejada (Blocos 1–4)</div>
            <div class="valor">${r.progressoGeral.planejadoKm2.toFixed(1)} km²</div>
          </div>
          <div class="dash-card">
            <div class="rotulo">Área executada (soma das entregas)</div>
            <div class="valor">${r.progressoGeral.executadoKm2.toFixed(1)} km²</div>
            <div class="sub">valor bruto — pequenas sobreposições nas bordas das faixas de voo não são descontadas</div>
          </div>
          <div class="dash-card">
            <div class="rotulo">% concluído</div>
            <div class="valor">${r.progressoGeral.percentual.toFixed(1)}%</div>
            <div class="dash-barra-fundo">
              <div class="dash-barra-preenchida" style="width:${r.progressoGeral.percentual.toFixed(1)}%;background:#38bdf8"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-secao">
        <div class="dash-secao-titulo">Progresso por Bloco</div>
        <div class="dash-chart-wrap"><canvas id="dash-chart-blocos"></canvas></div>
      </div>

      <div class="dash-secao">
        <div class="dash-secao-titulo">Progresso por Entrega</div>
        <div class="dash-chart-wrap"><canvas id="dash-chart-entregas"></canvas></div>
      </div>

      <div class="dash-secao">
        <div class="dash-secao-titulo">Sobreposição do Plano de Voo com Florestas Públicas (CNFP)</div>
        <div class="dash-nota">
          Considerando apenas as categorias ligadas agora no mapa —
          <b>${r.cnfp.filtrosAtivos.join(", ") || "nenhuma"}</b>.
          Mude os filtros no painel de camadas e clique em "Recalcular" pra atualizar.
        </div>
        <div class="dash-grid" style="grid-template-columns: 200px 1fr;">
          <div class="dash-chart-wrap pequeno"><canvas id="dash-chart-cnfp"></canvas></div>
          <div id="dash-tabela-cnfp"></div>
        </div>
      </div>

      <div class="dash-secao">
        <div class="dash-secao-titulo">Sobreposição com Terras Indígenas</div>
        <div class="dash-grid">
          <div class="dash-card">
            <div class="rotulo">Área do Plano de Voo dentro de TI</div>
            <div class="valor">${r.ti.areaKm2.toFixed(2)} km²</div>
            <div class="sub">${r.ti.percentual.toFixed(2)}% da área total planejada</div>
          </div>
          <div class="dash-card">
            <div class="rotulo">Dessa área de TI, quanto já foi sobrevoado</div>
            <div class="valor">${r.ti.executadoKm2.toFixed(2)} km²</div>
            <div class="sub">${r.ti.percentualExecutado.toFixed(1)}% da área de TI já voada</div>
            <div class="dash-barra-fundo">
              <div class="dash-barra-preenchida" style="width:${r.ti.percentualExecutado.toFixed(1)}%;background:#fb7185"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-secao">
        <div class="dash-secao-titulo">Sobreposição com Imóveis SICAR</div>
        <div class="dash-nota">
          Considerando os filtros ativos agora no mapa —
          Tipo: <b>${r.sicar.filtrosAtivos.tipos.join(", ") || "nenhum"}</b> ·
          Status: <b>${r.sicar.filtrosAtivos.status.join(", ") || "nenhum"}</b>.
          Mude os filtros no painel de camadas e clique em "Recalcular" pra atualizar.
        </div>
        <div class="dash-chart-wrap pequeno"><canvas id="dash-chart-sicar"></canvas></div>
      </div>
    `;

    Object.values(graficos).forEach(g => g && g.destroy());

    function desenharGrafico(nomeInterno, elementoId, tipo, dados, opcoes) {
      try {
        if (typeof Chart === "undefined") throw new Error("Biblioteca Chart.js não carregou (variável Chart indefinida).");
        const canvas = document.getElementById(elementoId);
        if (!canvas) throw new Error(`Canvas #${elementoId} não encontrado.`);
        graficos[nomeInterno] = new Chart(canvas, { type: tipo, data: dados, options: opcoes });
      } catch (e) {
        console.error(`Falha ao desenhar o gráfico "${nomeInterno}":`, e);
        const canvas = document.getElementById(elementoId);
        if (canvas && canvas.parentElement) {
          canvas.parentElement.innerHTML =
            `<div class="dash-nota">⚠ Não foi possível desenhar este gráfico (${e.message}). Veja o Console (F12) para detalhes.</div>`;
        }
      }
    }

    if (r.porBloco.length) {
      desenharGrafico("blocos", "dash-chart-blocos", "bar", {
        labels: r.porBloco.map(b => "Bloco " + b.id),
        datasets: [{ label: "% executado", data: r.porBloco.map(b => b.percentual),
          backgroundColor: r.porBloco.map(b => coresBlocos[b.id] || "#67e8f9") }]
      }, opcoesBarraHorizontal());
    }

    if (r.porEntrega.length) {
      desenharGrafico("entregas", "dash-chart-entregas", "bar", {
        labels: r.porEntrega.map(e => e.nome),
        datasets: [{ label: "Área (km²)", data: r.porEntrega.map(e => e.areaKm2),
          backgroundColor: r.porEntrega.map(e => e.cor) }]
      }, opcoesBarraHorizontal());
    }

    if (r.cnfp.categorias.length) {
      desenharGrafico("cnfp", "dash-chart-cnfp", "doughnut", {
        labels: r.cnfp.categorias.map(c => c.categoria),
        datasets: [{ data: r.cnfp.categorias.map(c => c.areaKm2),
          backgroundColor: r.cnfp.categorias.map(c => (coresCNFP[c.categoria] && coresCNFP[c.categoria].fill) || "#888") }]
      }, { plugins: { legend: { display: false } }, maintainAspectRatio: false });
    }

    // A tabela do CNFP roda independente do gráfico — se o gráfico falhar, a tabela ainda aparece
    const tabelaCnfp = document.getElementById("dash-tabela-cnfp");
    if (tabelaCnfp) {
      tabelaCnfp.innerHTML = r.cnfp.categorias
        .slice()
        .sort((a, b) => b.areaKm2 - a.areaKm2)
        .map(c => `
          <div class="dash-legenda-item">
            <div class="dash-legenda-cor" style="background:${(coresCNFP[c.categoria] && coresCNFP[c.categoria].fill) || "#888"}"></div>
            <span class="dash-legenda-label">${c.categoria}: <b style="color:#fff">${c.areaKm2.toFixed(2)} km²</b></span>
          </div>`).join("") || `<div class="dash-nota">Nenhuma sobreposição encontrada.</div>`;
    }

    if (r.sicar.porTipo.length) {
      desenharGrafico("sicar", "dash-chart-sicar", "bar", {
        labels: r.sicar.porTipo.map(s => s.tipo),
        datasets: [{ label: "Área (km²)", data: r.sicar.porTipo.map(s => s.areaKm2),
          backgroundColor: r.sicar.porTipo.map(s => (sicarCorBase[s.tipo] && sicarCorBase[s.tipo].stroke) || "#999") }]
      }, opcoesBarraHorizontal());
    }
  }

  // ---------------------------------------------------------
  // Ponto de entrada público
  // ---------------------------------------------------------
  window.iniciarDashboard = function (config) {
    CONFIG = config;
    jaCalculado = false; // permite reconfigurar/recarregar dados e forçar novo cálculo
    injetarEstilos();
    montarDOM();
  };
})();
