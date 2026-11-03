/* ============================================================
   Me Leva
   - A mãe escolhe o lugar (figura ou voz) e confirma.
   - Modo "uber" (padrão): o Uber abre no celular dela já com saída e chegada,
     e o filho é avisado pelo ntfy para acompanhar e mandar os dados do carro.
   - Modo "filho": o pedido vai para o filho, que abre o Uber e responde com o carro.
   - O app da mãe fala o carro, a cor, a placa e o tempo.
   Tudo fica salvo só no celular (localStorage). Sem servidor próprio.
   ============================================================ */
(() => {
  "use strict";

  /* ---------- configuração ---------- */
  const NTFY = (window.ME_LEVA_NTFY || "https://ntfy.sh").replace(/\/$/, "");
  const NOMINATIM = window.ME_LEVA_NOMINATIM || "https://nominatim.openstreetmap.org";
  const CHAVE = "me-leva:v1";
  const BASE = location.origin + location.pathname;
  const AQUI = "aqui"; // "onde ela estiver" (usa o GPS na hora)
  const MAX_LUGARES = 40, MAX_ATALHOS = 30;
  const RAIO_CASA = 200; // metros: se ela estiver até aqui de casa, o carro busca no ponto marcado da casa // cabem folgados no celular, mesmo com foto em todos
  const EMOJIS = ["🏠", "👭", "💃", "🕺", "⛪", "🏥", "💊", "🛒", "💈", "🍽️", "🎉", "🎶", "🏦", "🚌", "🌳", "🏖️", "👨‍👩‍👧", "🧓", "🐶", "☕", "🎂", "🛍️", "🏡", "📍"];
  const CORES = ["#5B3DF5", "#FF6B5A", "#12A150", "#F59E0B", "#0EA5E9", "#E04F8F", "#8B5E3C", "#1D1A2B"];
  const CORES_CARRO = [["branco", "#FFFFFF"], ["prata", "#C9CDD3"], ["cinza", "#6B7280"], ["preto", "#111111"], ["vermelho", "#D92D20"], ["azul", "#1E4FBF"], ["verde", "#12A150"], ["bege", "#D8C3A5"]];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const canalNovo = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join(""); };
  const semAcento = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  /* Monta elementos sem innerHTML (o conteúdo vem de outro celular pela internet) */
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : String(f));
    return el;
  }

  /* ---------- dados ---------- */
  let cfg = carregar();
  function carregar() { try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch (e) { return null; } }
  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(cfg)); } catch (e) { aviso("Não consegui salvar. O celular está sem espaço?"); } }
  const demo = () => cfg && cfg.canal === "demo";
  const lugar = (id) => (id === AQUI ? { id: AQUI, nome: "Onde ela estiver", nomeMae: "Onde você está", ico: "📍", cor: "#0EA5E9" } : (cfg.lugares || []).find((l) => l.id === id));
  const topico = (tipo) => `meleva-${cfg.canal}-${tipo}`; // p = pedidos (mãe → filho), r = respostas (filho → mãe)
  const nomeFilho = () => (cfg.filho && cfg.filho.nome) || "meu filho";
  const modoUber = () => (cfg.modo || "uber") === "uber";
  const casaDela = () => (cfg.lugares || []).find((l) => l.casa && l.lat != null) || null;
  const distancia = (a, b) => { const R = 6371e3, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  // GPS pego antes, na tela de confirmar: o Uber precisa abrir direto no toque
  let gpsAgora = null;
  const emCasa = () => { const c = casaDela(); return !!(c && gpsAgora && distancia(gpsAgora, c) <= RAIO_CASA); };

  function dadosDemo() {
    const L = (id, nome, ico, cor, end, lat, lng, apelidos) => ({ id, nome, ico, cor, end, lat, lng, apelidos });
    return {
      canal: "demo", papel: "mae", modo: "uber", nome: "Maria", pin: "1234",
      filho: { nome: "Marcos", tel: "11987654321" },
      lugares: [
        { ...L("casa", "Minha casa", "🏠", "#12A150", "Rua das Flores, 120 - Centro, Taboão da Serra - SP", -23.6094, -46.759, "casa, minha casa, voltar, embora"), casa: true },
        L("cida", "Casa da Cida", "👭", "#E04F8F", "Rua dos Ipês, 45 - Jardim Maria Rosa, Taboão da Serra - SP", -23.6201, -46.7712, "cida, amiga, comadre"),
        L("salao", "Salão Estrela", "💃", "#5B3DF5", "Av. dos Autonomistas, 1500 - Centro, Osasco - SP", -23.5329, -46.7917, "baile, dança, dançar, forró, salão"),
        L("igreja", "Igreja", "⛪", "#F59E0B", "Praça da Matriz, 10 - Centro, Taboão da Serra - SP", -23.6056, -46.7801, "missa, igreja, culto"),
        L("posto", "Posto de saúde", "🏥", "#0EA5E9", "Rua da Saúde, 300 - Vila Iasi, Taboão da Serra - SP", -23.6152, -46.7655, "médico, posto, consulta, remédio"),
      ],
      rotas: [
        { id: "r1", nome: "Baile com a Cida", ico: "💃", paradas: ["casa", "cida", "salao"] },
        { id: "r2", nome: "Voltar do baile", ico: "🌙", paradas: [AQUI, "cida", "casa"] },
        { id: "r3", nome: "Voltar pra casa", ico: "🏠", paradas: [AQUI, "casa"] },
        { id: "r4", nome: "Igreja", ico: "⛪", paradas: ["casa", "igreja"] },
        { id: "r5", nome: "Posto de saúde", ico: "🏥", paradas: ["casa", "posto"] },
      ],
    };
  }

  /* ---------- voz: falar ---------- */
  let vozPt = null;
  function escolherVoz() { const vs = speechSynthesis.getVoices(); vozPt = vs.find((v) => /pt[-_]BR/i.test(v.lang) && /google|natural|neural/i.test(v.name)) || vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null; }
  if ("speechSynthesis" in window) { escolherVoz(); speechSynthesis.addEventListener?.("voiceschanged", escolherVoz); }
  function falar(texto) {
    if (!("speechSynthesis" in window) || !texto) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "pt-BR"; u.rate = .92; u.pitch = 1; if (vozPt) u.voice = vozPt;
    speechSynthesis.speak(u);
  }
  const soletrar = (placa) => (placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "").split("").join(", ");

  /* ---------- voz: ouvir ---------- */
  const Reconhecer = window.SpeechRecognition || window.webkitSpeechRecognition;
  let ouvinte = null;
  function ouvir() {
    if (!Reconhecer) { falar("Toque na figura do lugar para onde quer ir."); return; }
    if (ouvinte) { ouvinte.abort(); return; }
    speechSynthesis?.cancel();
    const r = new Reconhecer();
    r.lang = "pt-BR"; r.interimResults = true; r.maxAlternatives = 4; r.continuous = false;
    const caixa = $("#ouvindo"), txt = $("#ouvindo-texto");
    let entendeu = false;
    txt.textContent = "Pode falar…"; caixa.hidden = false;
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      txt.textContent = "“" + res[0].transcript + "”";
      if (res.isFinal) { entendeu = true; interpretar([...res].map((a) => a.transcript)); }
    };
    r.onerror = (e) => { if (e.error === "not-allowed") falar("Preciso de permissão para ouvir. Peça ajuda para liberar o microfone."); };
    r.onend = () => {
      caixa.hidden = true; ouvinte = null;
      if (!entendeu) falar("Não ouvi direito. Toque no botão e fale de novo, ou toque na figura.");
    };
    ouvinte = r; r.start();
  }
  // tocar fora da caixa cancela
  $("#ouvindo").addEventListener("click", () => ouvinte && ouvinte.abort());

  const PALAVRAS_VAZIAS = new Set("eu quero queria ir vou vamos pra para pro a o as os da do de das dos na no em com um uma me leva levar ate agora por favor la ai".split(" "));
  function pontuar(texto, palavras, peso) {
    let s = 0;
    for (const p of palavras) {
      const w = semAcento(p);
      if (!w) continue;
      if (w.includes(" ") ? texto.includes(w) : new RegExp("\\b" + w + "\\b").test(texto)) s += peso * (w.includes(" ") ? 2 : 1);
    }
    return s;
  }
  const palavrasDe = (t) => semAcento(t).split(" ").filter((w) => w.length > 2 && !PALAVRAS_VAZIAS.has(w));
  function palavrasLugar(l) { return l ? [...palavrasDe(l.nome), ...String(l.apelidos || "").split(",").map((x) => x.trim()).filter(Boolean)] : []; }

  // devolve { tipo: "rota", rota } | { tipo: "ligar" } | null
  function entender(textos) {
    let melhor = null;
    for (const bruto of textos) {
      const t = semAcento(bruto);
      if (/\b(ligar|liga|ligue|telefon\w*)\b/.test(t)) return { tipo: "ligar" };
      for (const r of cfg.rotas || []) {
        const ps = r.paradas.map(lugar).filter(Boolean);
        let s = pontuar(t, palavrasDe(r.nome), 2);
        ps.forEach((l, i) => {
          if (l.id === AQUI) return;
          const ultimo = i === ps.length - 1, p = pontuar(t, palavrasLugar(l), ultimo ? 3 : 1.5);
          s += p + (ultimo && p > 0 ? 2 : 0); // o lugar falado é o destino: vale mais
        });
        if (s > 0 && (!melhor || s > melhor.s)) melhor = { s, rota: r };
      }
      // um lugar sozinho, sem atalho: vai de onde ela estiver até lá
      for (const l of cfg.lugares || []) {
        const p = pontuar(t, palavrasLugar(l), 2.5), s = p > 0 ? p + 2 : 0;
        if (s > 0 && (!melhor || s > melhor.s)) melhor = { s, rota: { id: "voz-" + l.id, nome: l.nome, ico: l.ico, paradas: [AQUI, l.id] } };
      }
    }
    return melhor ? { tipo: "rota", rota: melhor.rota } : null;
  }
  function interpretar(textos) {
    const r = entender(textos);
    if (!r) { falar("Não entendi para onde. Fale o nome do lugar, ou toque na figura."); return; }
    if (r.tipo === "ligar") { ligarFilho(); return; }
    abrirConfirmar(r.rota);
  }

  /* ---------- roteador ---------- */
  const telas = ["inicio", "papel", "mae", "confirmar", "esperando", "filho", "ajustes", "lugar", "rota"];
  let rotaPendente = null, desbloqueado = false;
  function mostrar(nome) {
    telas.forEach((t) => { $("#v-" + t).hidden = t !== nome; });
    document.body.dataset.tela = nome;
    window.scrollTo(0, 0);
    if (nome !== "filho") pararPedidos();
    if (nome !== "esperando") pararRespostas();
  }
  function rotear() {
    const partes = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const [p0, p1, p2] = partes;
    if (p0 === "parear" && p1) return parear(p1, p2);
    if (!cfg) return mostrar(p0 === "papel" ? "papel" : "inicio");
    barraDemo();
    if (p0 === "ajustes") return desbloqueado ? (mostrar("ajustes"), desenharAjustes()) : irInicio();
    if (p0 === "lugar") return desbloqueado ? (mostrar("lugar"), editarLugar(p1)) : irInicio();
    if (p0 === "rota") return desbloqueado ? (mostrar("rota"), editarRota(p1)) : irInicio();
    if (cfg.papel === "filho" || p0 === "filho") { mostrar("filho"); return desenharFilho(); }
    if (p0 === "confirmar" && rotaPendente) { mostrar("confirmar"); return desenharConfirmar(); }
    if (cfg.pedido && Date.now() - cfg.pedido.t < 4 * 3600e3 && cfg.pedido.estado !== "entrou" && cfg.pedido.estado !== "cancelado") { mostrar("esperando"); return desenharEsperando(true); }
    mostrar("mae"); desenharMae();
  }
  function irInicio() { if (location.hash !== "#/") location.hash = "#/"; else rotear(); }
  addEventListener("hashchange", rotear);

  /* ---------- tela da mãe ---------- */
  function saudacao() { const hr = new Date().getHours(); return hr < 12 ? "Bom dia" : hr < 18 ? "Boa tarde" : "Boa noite"; }
  function fundoFoto(el, foto) { if (foto) el.style.backgroundImage = `url("${foto}")`; }
  function destino(r) { return lugar(r.paradas[r.paradas.length - 1]); }
  function desenharMae() {
    $("#mae-saudacao").textContent = saudacao();
    $("#mae-nome").textContent = cfg.nome || "Olá";
    const f = $("#mae-foto"); f.textContent = cfg.foto ? "" : "👵"; fundoFoto(f, cfg.foto);
    $("#ligar-nome").textContent = cfg.filho?.nome ? "Ligar " + cfg.filho.nome : "Ligar";
    $("#ligar-filho").href = telLink();
    $("#esp-ligar").href = telLink();
    $("#mic-dica").textContent = Reconhecer ? "Toque e fale" : "Toque na figura";
    $("#microfone").hidden = !Reconhecer;
    const box = $("#atalhos"); box.textContent = "";
    const muitos = (cfg.rotas || []).length > 6;
    box.classList.toggle("atalhos--muitos", muitos);
    (cfg.rotas || []).forEach((r, i) => {
      const d = destino(r) || {}, ps = r.paradas.map(lugar).filter(Boolean);
      const foto = d.foto && !r.icoProprio ? d.foto : null;
      const b = h("button", { class: "atalho" + (foto ? " atalho--foto" : ""), style: `--cor:${d.cor || "#5B3DF5"}` + (i === 0 && !muitos && (cfg.rotas.length % 2) ? ";grid-column:1/-1;aspect-ratio:2/1.05" : ""), onclick: () => abrirConfirmar(r), "aria-label": r.nome },
        foto ? h("span", { class: "atalho__fundo", style: `background-image:url("${foto}")` }) : null,
        h("span", { class: "atalho__ico", "aria-hidden": "true" }, r.ico || d.ico || "📍"),
        h("span", { class: "atalho__nome" }, r.nome),
        ps.length > 2 ? h("span", { class: "atalho__trilha", "aria-hidden": "true" }, ps.flatMap((l, j) => (j ? [h("i", null, "›"), l.ico] : [l.ico]))) : null);
      box.append(b);
    });
  }
  function telLink() { const t = (cfg.filho?.tel || "").replace(/\D/g, ""); return t ? "tel:" + (t.length <= 11 ? "+55" + t : "+" + t) : "#"; }
  function ligarFilho() { if (cfg.filho?.tel) { falar("Ligando para " + nomeFilho()); location.href = telLink(); } else falar("O telefone do " + nomeFilho() + " não está cadastrado."); }
  $("#microfone").addEventListener("click", ouvir);
  $("#ligar-filho").addEventListener("click", (e) => { e.preventDefault(); ligarFilho(); });

  /* engrenagem: segurar 2 s para abrir a senha (a mãe não entra sem querer) */
  (() => {
    const g = $("#engrenagem"); let t0 = 0, raf = 0;
    const parar = () => { cancelAnimationFrame(raf); g.style.setProperty("--p", 0); t0 = 0; };
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); t0 = performance.now();
      const passo = (agora) => { if (!t0) return; const p = Math.min(100, (agora - t0) / 20); g.style.setProperty("--p", p); if (p >= 100) { parar(); pedirSenha(); } else raf = requestAnimationFrame(passo); };
      raf = requestAnimationFrame(passo);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => g.addEventListener(ev, parar));
    g.addEventListener("contextmenu", (e) => e.preventDefault());
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pedirSenha(); } });
  })();

  /* ---------- confirmar ---------- */
  function abrirConfirmar(r) { rotaPendente = r; location.hash = "#/confirmar"; }
  function frase(r) {
    const ps = r.paradas.map(lugar).filter(Boolean), nome = (l) => (l.id === AQUI ? "onde você está" : l.nome);
    const meio = ps.slice(1, -1).map(nome);
    if (modoUber()) return `Vamos para ${nome(ps[ps.length - 1])}${meio.length ? ", passando na " + meio.join(" e na ") : ""}. Toque no verde para abrir o Uber, ou no vermelho para voltar.`;
    return `Vou pedir o carro. Saindo de ${nome(ps[0])}${meio.length ? ", passando na " + meio.join(" e na ") : ""}, até ${nome(ps[ps.length - 1])}. Toque no verde para pedir, ou no vermelho para voltar.`;
  }
  function saidaReal(r) {
    const ps = r.paradas.map(lugar).filter(Boolean);
    if (ps[0] && ps[0].id === AQUI && ps.length > 1 && emCasa() && ps[ps.length - 1].id !== casaDela().id) ps[0] = casaDela();
    return ps;
  }
  function desenharConfirmar() {
    const r = rotaPendente;
    pintarCaminho(r);
    falar(frase(r));
    // pega o GPS agora para saber se ela está em casa (e redesenha a saída quando chegar)
    gpsAgora = null;
    if (r.paradas[0] === AQUI && casaDela()) posicao(5000).then((g) => { if (g) { gpsAgora = g; if (rotaPendente === r && document.body.dataset.tela === "confirmar") pintarCaminho(r); } });
  }
  function pintarCaminho(r) {
    const ps = saidaReal(r);
    $("#conf-titulo").textContent = r.nome;
    $(".confirmar__rotulo").textContent = modoUber() ? "Vou abrir o Uber" : "Vou pedir o carro";
    $(".decidir__sim span").textContent = modoUber() ? "Sim, abrir Uber" : "Sim, pedir";
    const ol = $("#conf-caminho"); ol.textContent = "";
    ps.forEach((l, i) => {
      const ico = h("span", { class: "caminho__ico" + (l.foto ? " caminho__ico--foto" : ""), style: `--cor:${l.cor}`, "aria-hidden": "true" }, l.ico); fundoFoto(ico, l.foto);
      ol.append(h("li", null, ico, h("span", { class: "caminho__txt" }, h("small", null, i === 0 ? "Sai de" : i === ps.length - 1 ? "Chega em" : "Passa em"), h("b", null, l.id === AQUI ? l.nomeMae : l.nome))));
    });
  }

  /* ---------- enviar pedido ---------- */
  function posicao(idadeMax = 60000) {
    return new Promise((ok) => {
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition((p) => ok({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), () => ok(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: idadeMax });
    });
  }
  function paradasDoPedido(r, gps) {
    return r.paradas.map(lugar).filter(Boolean).map((l) => ({
      nome: l.id === AQUI ? (gps ? "Onde ela está agora" : "Onde ela está (sem GPS)") : l.nome, ico: l.ico, cor: l.cor,
      end: l.id === AQUI ? "" : l.end || "", lat: l.id === AQUI ? gps?.lat : l.lat, lng: l.id === AQUI ? gps?.lng : l.lng, aqui: l.id === AQUI || undefined,
    }));
  }
  /* Abre o Uber com saída e chegada prontas. Precisa acontecer direto no toque,
     senão o Android abre o site em vez do aplicativo do Uber. */
  function abrirUber(p) {
    const url = linkUber(p);
    if (demo()) { aviso("Aqui o Uber abriria com a saída e a chegada prontas"); return; }
    const w = window.open(url, "_blank", "noopener");
    if (!w) location.href = url;
  }
  function pedirPeloUber(r) {
    const casa = emCasa() && r.paradas[0] === AQUI && r.paradas[r.paradas.length - 1] !== casaDela().id ? casaDela() : null;
    const comCasa = (ps) => (casa ? [{ nome: casa.nome, ico: casa.ico, cor: casa.cor, end: casa.end || "", lat: casa.lat, lng: casa.lng }, ...ps.slice(1)] : ps);
    const pedido = { v: 1, id: uid(), t: Date.now(), de: cfg.nome || "Mãe", rota: r.nome, uber: true, paradas: comCasa(paradasDoPedido(r, null)) };
    cfg.pedido = { ...pedido, estado: "uber" }; salvar();
    falar("Abrindo o Uber.");
    abrirUber(pedido);
    location.hash = "#/esperando";
    // avisa o filho para acompanhar (com a localização dela, se tiver GPS)
    (r.paradas.includes(AQUI) ? (gpsAgora ? Promise.resolve(gpsAgora) : posicao()) : Promise.resolve(null)).then((gps) => {
      const p = { ...pedido, paradas: comCasa(paradasDoPedido(r, gps)) };
      if (cfg.pedido?.id === p.id) { cfg.pedido.paradas = p.paradas; salvar(); }
      return publicarPedido(p);
    }).catch(() => {});
  }
  async function enviarPedido() {
    const r = rotaPendente; if (!r) return irInicio();
    if (modoUber()) return pedirPeloUber(r);
    const btn = $('[data-acao="enviar-pedido"]'); btn.disabled = true;
    falar("Certo! Vou avisar o " + nomeFilho() + ".");
    let gps = null;
    if (r.paradas.includes(AQUI)) gps = await posicao();
    const paradas = paradasDoPedido(r, gps);
    const pedido = { v: 1, id: uid(), t: Date.now(), de: cfg.nome || "Mãe", rota: r.nome, paradas };
    cfg.pedido = { ...pedido, estado: "enviado" }; salvar();
    try { await publicarPedido(pedido); }
    catch (e) { cfg.pedido.estado = "falhou"; salvar(); }
    btn.disabled = false;
    location.hash = "#/esperando";
  }
  const b64 = { de: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))), para: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
  function linkUber(p) {
    const o = p.paradas[0], d = p.paradas[p.paradas.length - 1], q = new URLSearchParams({ action: "setPickup" });
    const por = (pre, l) => { if (l.lat == null) return false; q.set(pre + "[latitude]", l.lat); q.set(pre + "[longitude]", l.lng); q.set(pre + "[nickname]", l.nome); if (l.end) q.set(pre + "[formatted_address]", l.end); return true; };
    if (!por("pickup", o)) q.set("pickup", "my_location");
    por("dropoff", d);
    return "https://m.uber.com/ul/?" + q.toString();
  }
  const linkMapa = (l) => (l.lat != null ? `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}` : l.end ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.end)}` : null);
  function textoPedido(p) { return p.paradas.map((l, i) => `${l.ico} ${i === 0 ? "Sai: " : i === p.paradas.length - 1 ? "Chega: " : "Parada: "}${l.nome}${l.end ? " (" + l.end + ")" : ""}`).join("\n"); }

  /* ---------- transporte (ntfy) ---------- */
  async function publicar(corpo) {
    const r = await fetch(NTFY, { method: "POST", body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error("ntfy " + r.status);
  }
  function publicarPedido(p) {
    if (demo()) return demoFilhoResponde(p);
    const app = BASE + "#/filho/" + b64.para(p);
    if (p.uber) return publicar({
      topic: topico("p"), title: `${p.de} abriu o Uber: ${p.rota}`, message: textoPedido(p) + "\n\nEla está chamando o carro pelo celular dela. Quando souber o carro, toque em Avisar o carro.", tags: ["taxi"], priority: 4, click: app,
      actions: [{ action: "view", label: "Avisar o carro", url: app }],
    });
    return publicar({
      topic: topico("p"), title: `${p.de} quer ir: ${p.rota}`, message: textoPedido(p), tags: ["taxi"], priority: 5, click: app,
      actions: [{ action: "view", label: "Abrir no Uber", url: linkUber(p), clear: false }, { action: "view", label: "Responder", url: app }],
    });
  }
  function publicarEvento(tipo, pedidoId, extra) {
    if (demo()) return Promise.resolve();
    const dados = { v: 1, tipo, pedido: pedidoId, t: Date.now(), ...extra };
    const msgs = { cancelou: "Cancelou o pedido", entrou: "Entrou no carro ✅" };
    return publicar({ topic: topico("p"), title: `${cfg.nome || "Mãe"}: ${msgs[tipo] || tipo}`, message: msgs[tipo] || tipo, tags: [tipo === "entrou" ? "white_check_mark" : "x"], priority: 3, click: BASE + "#/filho/" + b64.para(dados) });
  }
  function responder(dados) {
    if (demo()) return Promise.resolve();
    return publicar({ topic: topico("r"), title: "me-leva", message: JSON.stringify({ v: 1, t: Date.now(), ...dados }), priority: 3 });
  }
  async function buscar(t, desde) {
    const r = await fetch(`${NTFY}/${t}/json?poll=1&since=${encodeURIComponent(desde)}`, { cache: "no-store" });
    if (!r.ok) throw new Error("ntfy " + r.status);
    return (await r.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((m) => m && m.event === "message");
  }

  /* ---------- esperando o carro ---------- */
  let relogioRespostas = 0, alertaDemora = 0;
  function pararRespostas() { clearInterval(relogioRespostas); relogioRespostas = 0; clearTimeout(alertaDemora); }
  function desenharEsperando(primeira) {
    const p = cfg.pedido; if (!p) return irInicio();
    const tela = $("#v-esperando"), est = p.estado, f = nomeFilho();
    const uber = !!p.uber, idx = { falhou: -1, uber: 0, enviado: 0, visto: 1, chamando: 1, ligo: 1, carro: 2 }[est] ?? 0;
    $$("#etapas li").forEach((li, i) => { li.classList.toggle("feito", i <= idx); li.classList.toggle("agora", i === idx + 1); });
    $("#etapa-enviado").textContent = uber ? "Uber aberto" : "Pedido enviado";
    $("#etapa-visto").textContent = uber ? f + " acompanhando" : f + " viu";
    $("#esp-uber").hidden = !uber || est === "carro";
    $("#esp-sair").textContent = uber ? "Voltar para o início" : "Cancelar pedido";
    tela.classList.toggle("chegando", est === "carro");
    const titulo = $("#esp-titulo"), sub = $("#esp-sub");
    $("#carro").hidden = est !== "carro"; $("#esp-entrei").hidden = est !== "carro" && !uber;
    if (est === "uber") { titulo.textContent = "Confirme no Uber"; sub.textContent = `No Uber, toque no botão preto grande lá embaixo. Quando o ${f} me avisar, eu falo qual carro vem.`; }
    else if (uber && (est === "visto" || est === "chamando")) { titulo.textContent = `O ${f} está acompanhando`; sub.textContent = "Quando o carro for aceito, eu falo qual é."; }
    else if (est === "falhou") { titulo.textContent = "Não consegui avisar"; sub.textContent = `Parece que está sem internet. Ligue para o ${f}.`; }
    else if (est === "enviado") { titulo.textContent = `Avisei o ${f}`; sub.textContent = "Espere um pouquinho, ele vai chamar o carro."; }
    else if (est === "visto" || est === "chamando") { titulo.textContent = `O ${f} está chamando o carro`; sub.textContent = "Já, já eu falo qual carro vem buscar."; }
    else if (est === "ligo") { titulo.textContent = `O ${f} vai te ligar`; sub.textContent = "Fique perto do telefone."; }
    else if (est === "carro") {
      const c = p.carro || {}; titulo.textContent = "Seu carro está a caminho!"; sub.textContent = "Quando ele chegar, confira a placa antes de entrar.";
      $("#carro-modelo").textContent = [c.modelo, c.cor].filter(Boolean).join(" ") || "Carro";
      $("#carro-placa").textContent = (c.placa || "").toUpperCase(); $("#carro-placa").hidden = !c.placa;
      $("#carro-min").textContent = c.min || "?";
      const cor = CORES_CARRO.find(([n]) => n === c.cor); $("#carro-cor").style.setProperty("--cor-carro", cor ? cor[1] : "transparent");
    }
    if (primeira) iniciarRespostas();
  }
  function falaEsperando() {
    const p = cfg.pedido, f = nomeFilho(); if (!p) return;
    const c = p.carro || {};
    const t = {
      falhou: `Não consegui avisar o ${f}. Parece que está sem internet. Toque no botão verde para ligar para ele.`,
      enviado: `Avisei o ${f}. Espere um pouquinho que ele vai chamar o carro.`,
      uber: `Abri o Uber. Lá no Uber, toque no botão preto grande, embaixo, para chamar o carro. Se o Uber não abriu, toque no botão roxo. Quando o ${f} me avisar, eu falo qual carro vem buscar.`,
      visto: p.uber ? `O ${f} está acompanhando a sua corrida.` : `O ${f} viu o seu pedido e está chamando o carro.`, chamando: `O ${f} está chamando o carro.`,
      ligo: `O ${f} vai te ligar. Fique perto do telefone.`,
      carro: `Seu carro está chegando! É um ${[c.modelo, c.cor].filter(Boolean).join(" ")}. ${c.placa ? "A placa é: " + soletrar(c.placa) + "." : ""} ${c.min ? "Chega em " + c.min + " minutos." : ""} Confira a placa antes de entrar.`,
    }[p.estado];
    falar(t);
  }
  function aplicarResposta(d) {
    const p = cfg.pedido; if (!p || d.pedido !== p.id) return;
    const ordem = { uber: 0, enviado: 0, visto: 1, chamando: 1, ligo: 1, carro: 2 };
    if ((ordem[d.tipo] ?? -1) < (ordem[p.estado] ?? 0) && p.estado !== "falhou") return;
    p.estado = d.tipo; if (d.tipo === "carro") p.carro = { modelo: d.modelo, cor: d.cor, placa: d.placa, min: d.min };
    salvar(); desenharEsperando(false); falaEsperando();
  }
  function iniciarRespostas() {
    pararRespostas();
    const p = cfg.pedido; if (!p) return;
    falaEsperando();
    // se em 4 minutos ninguém viu, oferece ligar
    alertaDemora = setTimeout(() => { if (cfg.pedido?.estado === "enviado" && !cfg.pedido.uber) falar(`O ${nomeFilho()} ainda não viu o pedido. Toque no botão verde para ligar para ele.`); }, 4 * 60e3);
    if (demo()) return;
    let desde = Math.floor(p.t / 1000) - 5;
    const vez = async () => {
      try {
        const msgs = await buscar(topico("r"), desde);
        for (const m of msgs) { desde = m.id; try { aplicarResposta(JSON.parse(m.message)); } catch (e) {} }
        if (cfg.pedido?.estado === "falhou") { cfg.pedido.estado = "enviado"; salvar(); desenharEsperando(false); }
      } catch (e) { /* sem internet: tenta de novo */ }
    };
    // se o envio falhou, tenta reenviar quando a internet voltar
    if (p.estado === "falhou" && !p.uber) publicarPedido(p).then(() => { cfg.pedido.estado = "enviado"; salvar(); desenharEsperando(false); falaEsperando(); }).catch(() => {});
    vez(); relogioRespostas = setInterval(vez, 4000);
  }

  /* demonstração: o "filho" responde sozinho */
  function demoFilhoResponde(p) {
    const passo = (ms, d) => setTimeout(() => aplicarResposta({ pedido: p.id, ...d }), ms);
    passo(3500, { tipo: "visto" });
    passo(9000, { tipo: "carro", modelo: "Onix", cor: "prata", placa: "RIO2A19", min: 6 });
    return new Promise((ok) => setTimeout(ok, 600));
  }

  /* ---------- tela do filho ---------- */
  let relogioPedidos = 0, desdePedidos = null;
  const pedidosVistos = new Map(); // id -> pedido
  function pararPedidos() { clearInterval(relogioPedidos); relogioPedidos = 0; }
  function guardarPedido(p) { if (p && p.id && p.paradas) pedidosVistos.set(p.id, { ...(pedidosVistos.get(p.id) || {}), ...p }); }
  function eventoPedido(d) { const p = pedidosVistos.get(d.pedido); if (p) p.fim = d.tipo; }
  function lerClick(m) { try { const i = (m.click || "").indexOf("#/filho/"); return i >= 0 ? b64.de(m.click.slice(i + 8)) : null; } catch (e) { return null; } }
  function desenharFilho() {
    $("#filho-de").textContent = cfg.nomeMae || cfg.nome || "Mãe";
    const avisoOk = (() => { try { return localStorage.getItem("me-leva:ntfy-ok"); } catch (e) { return null; } })();
    $("#aviso-ntfy").hidden = !!avisoOk || demo();
    $("#ntfy-assinar").href = `ntfy://${NTFY.replace(/^https?:\/\//, "")}/${topico("p")}`;
    // pedido aberto pelo link da notificação
    const parte = location.hash.split("/")[2];
    if (parte) { try { const d = b64.de(parte); if (d.paradas) { guardarPedido(d); marcarVisto(d); } else eventoPedido(d); } catch (e) {} }
    if (demo() && !pedidosVistos.size) guardarPedido({ v: 1, id: "demo1", t: Date.now() - 60e3, de: "Maria", rota: "Baile com a Cida", uber: true, paradas: dadosDemo().rotas[0].paradas.map((id) => { const l = dadosDemo().lugares.find((x) => x.id === id); return { nome: l.nome, ico: l.ico, cor: l.cor, end: l.end, lat: l.lat, lng: l.lng }; }) });
    listarPedidos();
    if (!demo() && !relogioPedidos) {
      desdePedidos = desdePedidos || "12h";
      const vez = async () => {
        const vivo = $("#ao-vivo");
        try {
          const msgs = await buscar(topico("p"), desdePedidos);
          let novo = false;
          for (const m of msgs) { desdePedidos = m.id; const d = lerClick(m); if (!d) continue; if (d.paradas) { if (!pedidosVistos.has(d.id)) { novo = true; if (document.visibilityState === "visible") marcarVisto(d); } guardarPedido(d); } else eventoPedido(d); }
          vivo.classList.remove("off"); vivo.lastChild.textContent = "ao vivo";
          if (novo) { listarPedidos(); navigator.vibrate?.([200, 100, 200]); } else if (msgs.length) listarPedidos();
        } catch (e) { vivo.classList.add("off"); vivo.lastChild.textContent = "sem internet"; }
      };
      vez(); relogioPedidos = setInterval(vez, 5000);
    }
  }
  const respondidos = (() => { try { return JSON.parse(localStorage.getItem("me-leva:respondidos")) || {}; } catch (e) { return {}; } })();
  function marcarResposta(id, tipo) { respondidos[id] = tipo; try { localStorage.setItem("me-leva:respondidos", JSON.stringify(respondidos)); } catch (e) {} }
  function marcarVisto(p) { if (!respondidos[p.id] && Date.now() - p.t < 3 * 3600e3) { marcarResposta(p.id, "visto"); responder({ tipo: "visto", pedido: p.id }).catch(() => {}); } }
  const horaDe = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  function copiar(texto) { navigator.clipboard?.writeText(texto).then(() => aviso("Endereço copiado"), () => aviso(texto)); }
  function listarPedidos() {
    const box = $("#pedidos"); box.textContent = "";
    const lista = [...pedidosVistos.values()].sort((a, b) => b.t - a.t).slice(0, 10);
    $("#pedidos-vazio").hidden = lista.length > 0;
    lista.forEach((p) => {
      const antigo = Date.now() - p.t > 3 * 3600e3 || p.fim;
      const estado = p.fim === "cancelou" ? ["Cancelado", "etiqueta--off"] : p.fim === "entrou" ? ["Entrou no carro ✅", "etiqueta--ok"] : respondidos[p.id] === "carro" ? ["Carro enviado", "etiqueta--ok"] : antigo ? ["Antigo", "etiqueta--off"] : ["Novo pedido", ""];
      const trajeto = h("ol", { class: "trajeto" }, p.paradas.map((l, i) => {
        const mapa = linkMapa(l), ultimo = i === p.paradas.length - 1;
        return h("li", null,
          h("span", { class: "trajeto__ico", style: `--cor:${l.cor || "#eee"}` }, l.ico),
          h("div", null, h("small", null, i === 0 ? "Sai de" : ultimo ? "Chega em" : "Parada"), h("b", null, l.nome), l.end ? h("span", null, l.end) : null),
          i > 0 && !ultimo && l.end ? h("button", { class: "copiar", onclick: () => copiar(l.end) }, "Copiar") : mapa ? h("a", { class: "copiar", href: mapa, target: "_blank", rel: "noopener" }, "Mapa") : null);
      }));
      const temParada = p.paradas.length > 2;
      const acoes = h("div", { class: "pedido__acoes" },
        p.uber ? null : h("a", { class: "botao botao--uber", href: linkUber(p), target: "_blank", rel: "noopener", onclick: () => { if (respondidos[p.id] !== "carro") { marcarResposta(p.id, "chamando"); responder({ tipo: "chamando", pedido: p.id }).catch(() => {}); } } }, "Abrir no Uber"),
        h("button", { class: "botao botao--claro", onclick: () => { marcarResposta(p.id, "ligo"); responder({ tipo: "ligo", pedido: p.id }).then(() => aviso("Avisei que você vai ligar"), () => aviso("Sem internet")); } }, "Vou ligar"),
        h("button", { class: "botao botao--claro", onclick: (e) => { const f = e.currentTarget.closest(".pedido").querySelector(".responder"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); } }, "Avisar o carro"));
      let corEscolhida = "";
      const form = h("form", { class: "responder", hidden: true, onsubmit: (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget), d = { tipo: "carro", pedido: p.id, modelo: (fd.get("modelo") || "").trim(), cor: corEscolhida, placa: (fd.get("placa") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(), min: parseInt(fd.get("min"), 10) || "" };
        if (!d.modelo && !d.placa) return aviso("Coloque pelo menos o carro ou a placa");
        responder(d).then(() => { marcarResposta(p.id, "carro"); aviso(demo() ? "Na demonstração nada é enviado" : `Pronto! O app da ${p.de} vai falar o carro.`); listarPedidos(); }, () => aviso("Sem internet. Tente de novo."));
      } },
        h("b", null, "Qual carro vai buscar?"),
        h("div", { class: "responder__campos" },
          h("input", { name: "modelo", placeholder: "Carro (ex.: Onix)", autocomplete: "off" }),
          h("input", { name: "placa", placeholder: "Placa", autocomplete: "off", style: "text-transform:uppercase" }),
          h("input", { name: "min", class: "largo", type: "number", inputmode: "numeric", min: 1, max: 90, placeholder: "Chega em quantos minutos?" })),
        h("div", { class: "cores-carro", role: "group", "aria-label": "Cor do carro" }, CORES_CARRO.map(([n, c]) => h("button", { type: "button", style: `--c:${c}`, "aria-label": n, title: n, "aria-pressed": "false", onclick: (e) => { corEscolhida = n; $$("button", e.currentTarget.parentNode).forEach((b) => b.setAttribute("aria-pressed", b === e.currentTarget)); } }))),
        h("button", { class: "botao botao--verde", type: "submit" }, "Avisar ela 🔊"));
      box.append(h("article", { class: "pedido" + (antigo ? " pedido--antigo" : "") },
        h("div", { class: "pedido__cabeca" }, h("div", null, h("b", null, p.rota), h("small", null, `${p.de} · ${horaDe(p.t)}`)), h("span", { class: "etiqueta " + estado[1] }, estado[0])),
        trajeto,
        p.uber ? h("p", { class: "ajuda" }, `${p.de} já abriu o Uber no celular dela. Se ela está no seu Perfil Família do Uber, você vê o carro no seu app: toque em “Avisar o carro” para o app dela falar o modelo, a cor e a placa.`)
          : temParada ? h("p", { class: "ajuda" }, "No Uber, toque em “+” para adicionar a parada e use “Pedir para outra pessoa” com o telefone dela.") : null,
        antigo ? null : acoes, antigo ? null : form));
    });
  }

  /* ---------- pareamento (celular do filho) ---------- */
  function parear(canal, nomeMae) {
    if (!/^[a-z0-9]{10,40}$/.test(canal)) { aviso("Link inválido"); return irInicio(); }
    if (cfg && cfg.papel === "mae" && cfg.canal === canal) { aviso("Abra este link no SEU celular, não no dela."); return irInicio(); }
    cfg = { papel: "filho", canal, nomeMae: nomeMae || "Mãe" }; salvar();
    aviso("Pronto! Este celular vai receber os pedidos.");
    location.hash = "#/filho";
  }

  /* ---------- senha ---------- */
  let digitado = "";
  function pedirSenha() {
    if (demo()) aviso("Na demonstração a senha é 1234");
    if (!cfg.pin) { desbloqueado = true; location.hash = "#/ajustes"; return; }
    digitado = ""; pintarPin(); $("#modal-pin").hidden = false;
  }
  function pintarPin() { $$("#pin-pontos i").forEach((i, k) => i.classList.toggle("on", k < digitado.length)); }
  (() => {
    const t = $("#teclado");
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "✕", "0", "⌫"].forEach((k) => t.append(h("button", { type: "button", "aria-label": k === "✕" ? "Fechar" : k === "⌫" ? "Apagar" : k, onclick: () => {
      if (k === "✕") { $("#modal-pin").hidden = true; return; }
      if (k === "⌫") digitado = digitado.slice(0, -1); else if (digitado.length < 4) digitado += k;
      pintarPin();
      if (digitado.length === 4) {
        if (digitado === cfg.pin) { $("#modal-pin").hidden = true; desbloqueado = true; location.hash = "#/ajustes"; }
        else { const p = $("#pin-pontos"); p.classList.remove("erro"); void p.offsetWidth; p.classList.add("erro"); navigator.vibrate?.(200); setTimeout(() => { digitado = ""; pintarPin(); }, 400); }
      }
    } }, k)));
    $("#modal-pin").addEventListener("click", (e) => { if (e.target.id === "modal-pin") e.currentTarget.hidden = true; });
  })();

  /* ---------- ajustes ---------- */
  function desenharAjustes() {
    $("#cfg-nome").value = cfg.nome || ""; $("#cfg-filho").value = cfg.filho?.nome || ""; $("#cfg-tel").value = cfg.filho?.tel || ""; $("#cfg-pin").value = cfg.pin || "";
    $$('input[name="cfg-modo"]').forEach((i) => (i.checked = i.value === (cfg.modo || "uber")));
    $("#cont-rotas").textContent = `${(cfg.rotas || []).length} de ${MAX_ATALHOS}`;
    $("#cont-lugares").textContent = `${(cfg.lugares || []).length} de ${MAX_LUGARES}`;
    const fp = $("#foto-mae-prev"), fb = $("#foto-mae-btn"); fp.textContent = cfg.foto ? "" : "👵"; fb.style.backgroundImage = cfg.foto ? `url("${cfg.foto}")` : "";
    const rotas = $("#cfg-rotas"); rotas.textContent = "";
    const mover = (i, d) => { const j = i + d, rs = cfg.rotas; if (j < 0 || j >= rs.length) return; [rs[i], rs[j]] = [rs[j], rs[i]]; salvar(); desenharAjustes(); };
    (cfg.rotas || []).forEach((r, i, todas) => {
      const ps = r.paradas.map(lugar).filter(Boolean), d = destino(r) || {};
      const mini = h("span", { class: "mini", style: `--cor:${d.cor || "#5B3DF5"}` }, r.ico || d.ico);
      rotas.append(h("li", { class: "com-ordem" },
        h("button", { onclick: () => (location.hash = "#/rota/" + r.id) }, mini, h("div", null, h("b", null, r.nome), h("small", null, ps.map((l) => (l.id === AQUI ? "📍 Onde ela estiver" : l.ico + " " + l.nome)).join("  ›  "))), h("span", { class: "seta" }, "›")),
        h("span", { class: "ordem" },
          h("button", { type: "button", "aria-label": "Mais para cima", disabled: i === 0, onclick: () => mover(i, -1) }, "↑"),
          h("button", { type: "button", "aria-label": "Mais para baixo", disabled: i === todas.length - 1, onclick: () => mover(i, 1) }, "↓"))));
    });
    if (!rotas.children.length) rotas.append(h("li", { class: "ajuda" }, "Nenhum atalho ainda. Cada lugar que você cadastrar vira um atalho aqui."));
    const lugares = $("#cfg-lugares"); lugares.textContent = "";
    (cfg.lugares || []).forEach((l) => {
      const mini = h("span", { class: "mini", style: `--cor:${l.cor}` }, l.foto ? "" : l.ico); fundoFoto(mini, l.foto);
      lugares.append(h("li", null, h("button", { onclick: () => (location.hash = "#/lugar/" + l.id) }, mini, h("div", null, h("b", null, l.nome, l.casa ? h("span", { class: "selo-casa" }, "embarque") : null), l.lat != null ? h("small", null, l.end || "Endereço salvo") : h("small", { class: "alerta" }, "Falta o endereço")), h("span", { class: "seta" }, "›"))));
    });
    if (!lugares.children.length) lugares.append(h("li", { class: "ajuda" }, "Comece pela casa dela."));
  }
  function lerAjustes() {
    cfg.nome = $("#cfg-nome").value.trim();
    cfg.filho = { nome: $("#cfg-filho").value.trim(), tel: $("#cfg-tel").value.replace(/\D/g, "") };
    const pin = $("#cfg-pin").value.replace(/\D/g, "");
    if (pin.length === 4) cfg.pin = pin;
    salvar();
  }
  ["#cfg-nome", "#cfg-filho", "#cfg-tel", "#cfg-pin"].forEach((s) => $(s).addEventListener("change", lerAjustes));
  $$('input[name="cfg-modo"]').forEach((i) => i.addEventListener("change", () => { if (i.checked) { cfg.modo = i.value; salvar(); } }));
  function sairAjustes() {
    lerAjustes();
    const falta = !cfg.nome ? "o nome dela" : !(cfg.rotas || []).length ? "pelo menos um atalho" : !cfg.pin ? "a senha dos ajustes (4 números)" : null;
    if (falta) return aviso("Falta " + falta);
    desbloqueado = false; irInicio();
  }
  function linkPareamento() { return `${BASE}#/parear/${cfg.canal}/${encodeURIComponent(cfg.nome || "Mãe")}`; }
  async function compartilharLink() {
    lerAjustes();
    if (demo()) return aviso("Na demonstração não há celular para conectar");
    const url = linkPareamento(), texto = `Abra no seu celular para receber os pedidos de carro da ${cfg.nome || "mãe"}: ${url}`;
    if (navigator.share) { try { await navigator.share({ title: "Me Leva", text: texto }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const tel = (cfg.filho?.tel || "").replace(/\D/g, "");
    window.open(`https://wa.me/${tel ? (tel.length <= 11 ? "55" + tel : tel) : ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }
  async function testarAviso() {
    lerAjustes();
    if (demo()) return aviso("Na demonstração nada é enviado");
    try { await publicar({ topic: topico("p"), title: "Me Leva: teste", message: `Se você recebeu isto, os pedidos da ${cfg.nome || "mãe"} vão chegar aqui. 🎉`, tags: ["tada"], priority: 4 }); aviso("Aviso de teste enviado"); }
    catch (e) { aviso("Sem internet. Tente de novo."); }
  }

  /* fotos: reduz para caber no celular */
  function lerFoto(input, aoTerminar) {
    const f = input.files && input.files[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const lado = 360, k = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      aoTerminar(c.toDataURL("image/jpeg", .78));
    };
    img.src = url; input.value = "";
  }
  $("#foto-mae").addEventListener("change", (e) => lerFoto(e.target, (d) => { cfg.foto = d; salvar(); desenharAjustes(); }));

  /* ---------- editar lugar ---------- */
  let rascunho = null;
  function editarLugar(id) {
    const l = id && id !== "novo" ? lugar(id) : null;
    rascunho = l ? { ...l } : { id: uid(), nome: "", ico: "🏠", cor: CORES[(cfg.lugares || []).length % CORES.length], apelidos: "" };
    $("#lugar-titulo").textContent = l ? "Editar lugar" : "Novo lugar";
    $("#lugar-excluir").hidden = !l;
    $("#lugar-casa").checked = l ? !!l.casa : !casaDela() && !(cfg.lugares || []).length;
    $("#lugar-atalho").checked = l ? (cfg.rotas || []).some((r) => r.auto === l.id) : (cfg.rotas || []).length < MAX_ATALHOS;
    $("#lugar-nome").value = rascunho.nome; $("#lugar-apelidos").value = rascunho.apelidos || ""; $("#lugar-busca").value = ""; $("#lugar-resultados").textContent = "";
    pintarLugar();
  }
  function pintarLugar() {
    const r = rascunho;
    $("#lugar-foto-prev").textContent = r.foto ? "" : r.ico; $("#lugar-foto-btn").style.backgroundImage = r.foto ? `url("${r.foto}")` : "";
    const em = $("#lugar-emojis"); em.textContent = "";
    EMOJIS.forEach((e) => em.append(h("button", { type: "button", "aria-pressed": String(e === r.ico), "aria-label": "Figura " + e, onclick: () => { r.ico = e; pintarLugar(); } }, e)));
    const co = $("#lugar-cores"); co.textContent = "";
    CORES.forEach((c) => co.append(h("button", { type: "button", style: `--c:${c}`, "aria-pressed": String(c === r.cor), "aria-label": "Cor " + c, onclick: () => { r.cor = c; pintarLugar(); } })));
    $("#lugar-endereco").textContent = r.lat != null ? r.end || `${r.lat}, ${r.lng}` : "";
    mostrarMapa(r.lat, r.lng);
    $("#lugar-mapa-dica").hidden = r.lat == null;
  }
  $("#lugar-foto").addEventListener("change", (e) => lerFoto(e.target, (d) => { rascunho.foto = d; pintarLugar(); }));
  $("#lugar-foto-btn").addEventListener("contextmenu", (e) => { e.preventDefault(); if (rascunho?.foto && confirm("Tirar a foto?")) { delete rascunho.foto; pintarLugar(); } });
  const ZOOM_MAPA = 18;
  function mostrarMapa(lat, lng) {
    const box = $("#lugar-mapa"); if (lat == null) { box.hidden = true; return; }
    box.hidden = false;
    const z = ZOOM_MAPA, n = 2 ** z, xt = ((lng + 180) / 360) * n, la = (lat * Math.PI) / 180, yt = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
    const tx = Math.floor(xt), ty = Math.floor(yt), px = (xt - tx) * 256, py = (yt - ty) * 256;
    const tiles = $("#lugar-tiles"); tiles.textContent = "";
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.append(h("img", { alt: "", loading: "lazy", src: `https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png`, style: `left:${(dx + 1) * 256}px;top:${(dy + 1) * 256}px` }));
    const w = box.clientWidth || 320, hgt = box.clientHeight || 180;
    tiles.style.left = `${w / 2 - (256 + px)}px`; tiles.style.top = `${hgt / 2 - (256 + py)}px`;
  }
  // tocar no mapa move o pino: serve para marcar o ponto exato (ex.: a entrada da viela)
  $("#lugar-mapa").addEventListener("click", (e) => {
    const r = rascunho; if (!r || r.lat == null) return;
    const box = e.currentTarget.getBoundingClientRect(), n = 256 * 2 ** ZOOM_MAPA;
    const la = (r.lat * Math.PI) / 180, px = ((r.lng + 180) / 360) * n, py = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
    const nx = px + (e.clientX - box.left - box.width / 2), ny = py + (e.clientY - box.top - box.height / 2);
    r.lng = +((nx / n) * 360 - 180).toFixed(6);
    r.lat = +((Math.atan(Math.sinh(Math.PI * (1 - (2 * ny) / n))) * 180) / Math.PI).toFixed(6);
    pintarLugar(); navigator.vibrate?.(30); aviso("Ponto ajustado");
  });
  async function buscarEndereco() {
    const q = $("#lugar-busca").value.trim(); if (q.length < 4) return aviso("Escreva a rua, o número e a cidade");
    const ul = $("#lugar-resultados"); ul.textContent = ""; ul.append(h("li", { class: "ajuda" }, "Procurando…"));
    try {
      const r = await fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
      const lista = await r.json(); ul.textContent = "";
      if (!lista.length) ul.append(h("li", { class: "ajuda" }, "Não achei. Tente sem o número, ou use “Estou neste lugar agora”."));
      lista.forEach((it) => ul.append(h("li", null, h("button", { type: "button", onclick: () => { Object.assign(rascunho, { lat: +(+it.lat).toFixed(6), lng: +(+it.lon).toFixed(6), end: enderecoCurto(it, q) }); ul.textContent = ""; pintarLugar(); } }, enderecoCurto(it, q), h("br"), h("small", null, it.display_name)))));
    } catch (e) { ul.textContent = ""; ul.append(h("li", { class: "ajuda" }, "Sem internet para buscar o endereço.")); }
  }
  function enderecoCurto(it, digitado) {
    const a = it.address || {}, num = a.house_number || (digitado.match(/\b\d{1,5}\b/) || [])[0];
    const rua = a.road || a.pedestrian || it.name || "";
    return [rua + (num ? ", " + num : ""), a.suburb || a.neighbourhood, a.city || a.town || a.village || a.municipality, a["ISO3166-2-lvl4"] ? a["ISO3166-2-lvl4"].replace("BR-", "") : a.state].filter(Boolean).join(" - ") || it.display_name;
  }
  async function usarGps() {
    aviso("Pegando a localização…");
    const p = await posicao(0); if (!p) return aviso("Não consegui a localização. Ative o GPS.");
    Object.assign(rascunho, p, { end: "" }); pintarLugar();
    try { const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&accept-language=pt-BR&lat=${p.lat}&lon=${p.lng}`); const it = await r.json(); rascunho.end = enderecoCurto(it, ""); pintarLugar(); } catch (e) {}
  }
  function salvarLugar() {
    const r = rascunho; r.nome = $("#lugar-nome").value.trim(); r.apelidos = $("#lugar-apelidos").value.trim();
    if (!r.nome) return aviso("Dê um nome ao lugar");
    if (r.lat == null) return aviso("Falta o endereço: busque ou use “Estou neste lugar agora”");
    cfg.lugares = cfg.lugares || []; cfg.rotas = cfg.rotas || [];
    const i = cfg.lugares.findIndex((l) => l.id === r.id);
    if (i < 0 && cfg.lugares.length >= MAX_LUGARES) return aviso(`Já são ${MAX_LUGARES} lugares. Exclua um que ela não usa mais.`);
    if ($("#lugar-casa").checked) { cfg.lugares.forEach((l) => delete l.casa); r.casa = true; } else delete r.casa;
    if (i >= 0) cfg.lugares[i] = r; else cfg.lugares.push(r);
    // atalho direto: sai de onde ela estiver e vai até este lugar
    const auto = cfg.rotas.find((x) => x.auto === r.id);
    if ($("#lugar-atalho").checked) {
      if (auto) Object.assign(auto, { nome: r.nome, ico: r.ico });
      else if (cfg.rotas.length < MAX_ATALHOS) cfg.rotas.push({ id: uid(), nome: r.nome, ico: r.ico, paradas: [AQUI, r.id], auto: r.id });
      else aviso(`Lugar salvo, mas já são ${MAX_ATALHOS} atalhos na tela dela.`);
    } else if (auto) cfg.rotas = cfg.rotas.filter((x) => x !== auto);
    salvar(); history.back();
  }
  function excluirLugar() {
    const usado = (cfg.rotas || []).filter((r) => r.auto !== rascunho.id && r.paradas.includes(rascunho.id));
    if (usado.length) return aviso("Este lugar está no atalho “" + usado[0].nome + "”. Tire de lá primeiro.");
    if (!confirm("Excluir este lugar?")) return;
    cfg.lugares = cfg.lugares.filter((l) => l.id !== rascunho.id);
    cfg.rotas = (cfg.rotas || []).filter((r) => r.auto !== rascunho.id);
    salvar(); history.back();
  }

  /* ---------- editar atalho ---------- */
  function editarRota(id) {
    const r = id && id !== "novo" ? (cfg.rotas || []).find((x) => x.id === id) : null;
    rascunho = r ? { ...r, paradas: [...r.paradas] } : { id: uid(), nome: "", ico: "", paradas: [] };
    $("#rota-titulo").textContent = r ? "Editar atalho" : "Novo atalho"; $("#rota-excluir").hidden = !r; $("#rota-nome").value = rascunho.nome;
    pintarRota();
  }
  function pintarRota() {
    const r = rascunho, ol = $("#rota-paradas"); ol.textContent = "";
    r.paradas.forEach((pid, i) => {
      const l = lugar(pid); if (!l) return;
      const mini = h("span", { class: "mini", style: `--cor:${l.cor}` }, l.foto ? "" : l.ico); fundoFoto(mini, l.foto);
      const mover = (d) => { const j = i + d; if (j < 0 || j >= r.paradas.length) return; [r.paradas[i], r.paradas[j]] = [r.paradas[j], r.paradas[i]]; pintarRota(); };
      ol.append(h("li", null, mini, h("div", null, h("small", null, i === 0 ? "Sai de" : i === r.paradas.length - 1 ? "Chega em" : "Parada"), h("b", null, l.nome)),
        h("span", { class: "paradas__btns" }, h("button", { type: "button", "aria-label": "Subir", onclick: () => mover(-1) }, "↑"), h("button", { type: "button", "aria-label": "Descer", onclick: () => mover(1) }, "↓"), h("button", { type: "button", "aria-label": "Tirar", onclick: () => { r.paradas.splice(i, 1); pintarRota(); } }, "✕"))));
    });
    if (!r.paradas.length) ol.append(h("li", { class: "ajuda", style: "display:block" }, "Toque nos lugares abaixo na ordem do caminho."));
    const add = $("#rota-adicionar"); add.textContent = "";
    if (modoUber() && r.paradas.length > 2) add.append(h("p", { class: "ajuda alerta" }, "O Uber abre só com a saída e a chegada. As paradas do meio precisam ser colocadas no Uber (no “+”)."));
    if (r.paradas.length >= 4) { add.append(h("p", { class: "ajuda" }, "Máximo de 4 pontos (saída, 2 paradas e chegada).")); return; }
    [AQUI, ...(cfg.lugares || []).map((l) => l.id)].forEach((pid) => { const l = lugar(pid); if (pid === AQUI && r.paradas.length) return; add.append(h("button", { type: "button", onclick: () => { r.paradas.push(pid); pintarRota(); } }, l.ico, " " + l.nome)); });
    if (!(cfg.lugares || []).length) add.append(h("p", { class: "ajuda" }, "Cadastre os lugares primeiro."));
  }
  function salvarRota() {
    const r = rascunho; r.nome = $("#rota-nome").value.trim();
    if (r.paradas.length < 2) return aviso("O caminho precisa de saída e chegada");
    if (!r.nome) { const d = lugar(r.paradas[r.paradas.length - 1]); r.nome = d.nome; }
    if (!r.ico) r.ico = lugar(r.paradas[r.paradas.length - 1]).ico;
    if (r.auto && (r.paradas.length !== 2 || r.paradas[0] !== AQUI || r.paradas[1] !== r.auto)) delete r.auto;
    cfg.rotas = cfg.rotas || [];
    const i = cfg.rotas.findIndex((x) => x.id === r.id); if (i >= 0) cfg.rotas[i] = r; else cfg.rotas.push(r);
    salvar(); history.back();
  }
  function excluirRota() { if (!confirm("Excluir este atalho?")) return; cfg.rotas = cfg.rotas.filter((x) => x.id !== rascunho.id); salvar(); history.back(); }

  /* ---------- barra da demonstração ---------- */
  function barraDemo() {
    let b = $("#barra-demo");
    if (!demo()) { b?.remove(); return; }
    if (!b) {
      b = h("div", { id: "barra-demo", class: "barra-demo" },
        h("span", null, "Demonstração"),
        h("button", { onclick: () => { cfg.papel = cfg.papel === "mae" ? "filho" : "mae"; salvar(); pedidosVistos.clear(); irInicio(); barraDemo(); } }, ""),
        h("button", { onclick: () => { cfg = null; try { localStorage.removeItem(CHAVE); } catch (e) {} speechSynthesis?.cancel(); $("#barra-demo")?.remove(); irInicio(); } }, "Sair"));
      document.body.append(b);
    }
    b.children[1].textContent = cfg.papel === "mae" ? "Ver lado do filho →" : "← Ver lado da mãe";
  }

  /* ---------- avisos ---------- */
  let tAviso = 0;
  function aviso(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(tAviso); tAviso = setTimeout(() => (el.hidden = true), 3200); }

  /* ---------- botões com data-acao ---------- */
  const acoes = {
    demo: () => { cfg = dadosDemo(); salvar(); irInicio(); },
    configurar: () => (location.hash = "#/papel"),
    "papel-mae": () => { cfg = { papel: "mae", modo: "uber", canal: canalNovo(), nome: "", filho: { nome: "", tel: "" }, lugares: [], rotas: [], pin: "" }; salvar(); desbloqueado = true; location.hash = "#/ajustes"; },
    "papel-filho": () => { aviso("No celular dela, abra os ajustes e toque em “Enviar link pro meu celular”."); },
    "ouvir-confirmar": () => rotaPendente && falar(frase(rotaPendente)),
    "cancelar-confirmar": () => { speechSynthesis?.cancel(); rotaPendente = null; irInicio(); },
    "enviar-pedido": enviarPedido,
    "ouvir-esperando": falaEsperando,
    entrei: () => { const p = cfg.pedido; if (!p) return; publicarEvento("entrou", p.id).catch(() => {}); p.estado = "entrou"; salvar(); falar("Boa viagem! Divirta-se."); irInicio(); },
    "abrir-uber": () => { const p = cfg.pedido; if (p) { falar("Abrindo o Uber."); abrirUber(p); } },
    "cancelar-pedido": () => { const p = cfg.pedido; if (!p) return irInicio(); if (p.uber) { p.estado = "cancelado"; salvar(); speechSynthesis?.cancel(); return irInicio(); } if (!confirm("Cancelar o pedido?")) return; publicarEvento("cancelou", p.id).catch(() => {}); p.estado = "cancelado"; salvar(); falar("Pedido cancelado."); irInicio(); },
    "fechar-aviso-ntfy": () => { try { localStorage.setItem("me-leva:ntfy-ok", "1"); } catch (e) {} $("#aviso-ntfy").hidden = true; },
    desconectar: () => { if (demo()) return aviso("Use “Sair” na barra de cima"); if (!confirm("Parar de receber os pedidos neste celular?")) return; cfg = null; try { localStorage.removeItem(CHAVE); } catch (e) {} irInicio(); },
    "sair-ajustes": sairAjustes,
    "compartilhar-link": compartilharLink,
    "testar-aviso": testarAviso,
    "nova-rota": () => { lerAjustes(); if ((cfg.rotas || []).length >= MAX_ATALHOS) return aviso(`Já são ${MAX_ATALHOS} atalhos. Exclua um que ela não usa mais.`); location.hash = "#/rota/novo"; },
    "novo-lugar": () => { lerAjustes(); if ((cfg.lugares || []).length >= MAX_LUGARES) return aviso(`Já são ${MAX_LUGARES} lugares. Exclua um que ela não usa mais.`); location.hash = "#/lugar/novo"; },
    "apagar-tudo": () => { if (!confirm("Apagar todos os lugares, atalhos e ajustes deste celular?")) return; cfg = null; desbloqueado = false; try { localStorage.removeItem(CHAVE); } catch (e) {} irInicio(); },
    "buscar-endereco": buscarEndereco,
    "usar-gps": usarGps,
    "salvar-lugar": salvarLugar,
    "excluir-lugar": excluirLugar,
    "salvar-rota": salvarRota,
    "excluir-rota": excluirRota,
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-acao]"); if (a && acoes[a.dataset.acao]) { e.preventDefault(); acoes[a.dataset.acao](); return; }
    const ir = e.target.closest("[data-ir]"); if (ir) { e.preventDefault(); location.hash = ir.dataset.ir; }
  });
  $("#lugar-busca").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarEndereco(); } });

  // quando ela volta do Uber para o app, lembra em voz alta o que fazer
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.body.dataset.tela === "esperando" && cfg?.pedido?.uber) falaEsperando();
  });

  /* ---------- início ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.MeLeva = { entender: (t) => entender([t]), linkUber, b64 }; // usado nos testes
  rotear();
})();
