/* ============================================================
   ⚙️ CONFIGURACIÓN — GOOGLE SHEETS
   ------------------------------------------------------------
   Misma URL de Apps Script que usa el sistema de meseros.
   El GET debe devolver un array de órdenes en JSON.
   ============================================================ */
const GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyZfhk6oMMbOYmAYQuGj7GRuG7__FrbB19Gc-8FT2D4M8kuxwladINGlcogRIPNqJef/exec";

/* Intervalo de auto-refresco (ms) */
const REFRESH_INTERVAL = 5000;

/* ============================================================
   ESTADO
   ============================================================ */
let ordenes = [];              // Todas las órdenes
let filtroActivo = "pendientes";
let ordenSeleccionada = null;
let cobroReciente = null;      // { uid, recibido, cambio } del último cobro hecho en esta sesión

const $ = (s, ctx=document) => ctx.querySelector(s);
const money = n => "$" + Number(n).toLocaleString("es-MX");
const money2 = n => "$" + Number(n).toLocaleString("es-MX",{minimumFractionDigits:0, maximumFractionDigits:2});
const redondear = n => Math.round(n * 100) / 100;

function toast(msg, tipo="ok"){
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  t.className = "toast show " + (tipo === "warn" ? "warn" : tipo === "err" ? "err" : "");
  clearTimeout(t._tm);
  t._tm = setTimeout(()=>t.classList.remove("show"), 2200);
}

/* ============================================================
   🔌 OBTENER ÓRDENES
   ------------------------------------------------------------
   En producción: fetch al Apps Script (GET) que devuelve JSON.
   En demo/offline: lee de localStorage (compartido en el mismo
   dispositivo) — útil para probar el flujo meseros → caja.
   ============================================================ */
async function obtenerOrdenes(){
  // Modo demo si la URL no está configurada
  if(!GOOGLE_SHEETS_WEBAPP_URL || GOOGLE_SHEETS_WEBAPP_URL.includes("XXXX")){
    return leerOrdenesLocales();
  }
  try{
    const res = await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: "GET" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }catch(err){
    console.error("[Caja] Error al obtener órdenes:", err);
    // Fallback a locales si hay red caída
    return leerOrdenesLocales();
  }
}

/* Lee las órdenes guardadas por los meseros en este mismo dispositivo */
function leerOrdenesLocales(){
  try{
    const raw = localStorage.getItem("ordenes_restaurante");
    return raw ? JSON.parse(raw) : [];
  }catch{ return []; }
}

/* Persiste cambios locales (marcar cobrada en modo demo) */
function guardarOrdenesLocales(){
  if(!GOOGLE_SHEETS_WEBAPP_URL || GOOGLE_SHEETS_WEBAPP_URL.includes("XXXX")){
    localStorage.setItem("ordenes_restaurante", JSON.stringify(ordenes));
  }
}

/* ============================================================
   🔄 REFRESCAR
   ============================================================ */
async function refrescar(silencioso = false){
  const nuevas = await obtenerOrdenes();
  ordenes = nuevas.map(normalizarOrden);
  renderResumen();
  renderLista();
  actualizarRefreshHora();

  // Si hay un detalle abierto, actualizarlo también
  if(ordenSeleccionada){
    const actual = ordenes.find(o => o.uid === ordenSeleccionada.uid);
    if(actual){
      ordenSeleccionada = actual;
      renderDetalle(actual);
    }else{
      cerrarDetalle();
    }
  }
  if($("#overlayStats").classList.contains("open")) renderStats();
  if(!silencioso) toast("Órdenes actualizadas");
}

/* Normaliza distintas formas de orden (Sheets vs localStorage) */
function normalizarOrden(o, i){
  const uid = o.uid || o.folio || ("o" + (o.timestamp || i));
  const estado = (o.estado || "pendiente").toLowerCase();
  return {
    uid,
    mesero: o.mesero || "Sin nombre",
    fecha: o.fecha || new Date(o.timestamp || Date.now()).toISOString(),
    timestamp: o.timestamp || new Date(o.fecha || Date.now()).getTime(),
    items: Array.isArray(o.items) ? o.items : [],
    total: Number(o.total) || 0,
    estado
  };
}

function actualizarRefreshHora(){
  const d = new Date();
  $("#refreshTxt").textContent = d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}

/* ============================================================
   📊 RESUMEN
   ============================================================ */
function renderResumen(){
  const pendientes = ordenes.filter(o => o.estado === "pendiente");
  const cobradasHoy = ordenes.filter(o => o.estado === "cobrada" && esDeHoy(o.timestamp));

  $("#rPendientes").textContent = pendientes.length;
  $("#rPorCobrar").textContent = money(pendientes.reduce((s,o)=>s+o.total,0));
  $("#rCobradas").textContent = money(cobradasHoy.reduce((s,o)=>s+o.total,0));
}

function esDeHoy(ts){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return ts >= hoy.getTime();
}

/* ============================================================
   📋 LISTA
   ============================================================ */
function renderLista(){
  const cont = $("#listaOrdenes");
  let lista = [...ordenes];

  if(filtroActivo === "pendientes") lista = lista.filter(o => o.estado === "pendiente");
  else if(filtroActivo === "cobradas") lista = lista.filter(o => o.estado === "cobrada");

  // Ordenar: pendientes arriba, más recientes primero
  lista.sort((a,b)=>{
    if(a.estado !== b.estado) return a.estado === "pendiente" ? -1 : 1;
    return b.timestamp - a.timestamp;
  });

  if(!lista.length){
    cont.innerHTML = `<div class="empty">
      <i class="bi bi-inbox"></i>
      <p>No hay órdenes ${filtroActivo === "pendientes" ? "pendientes" : filtroActivo === "cobradas" ? "cobradas" : "registradas"}.</p>
    </div>`;
    return;
  }

  cont.innerHTML = lista.map(ordenCardHTML).join("");

  cont.querySelectorAll(".orden-card").forEach(card=>{
    card.addEventListener("click", ()=>{
      const uid = card.dataset.uid;
      const o = ordenes.find(x=>x.uid === uid);
      if(o) abrirDetalle(o);
    });
  });
}

function ordenCardHTML(o){
  const hora = new Date(o.timestamp).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  const fecha = new Date(o.timestamp).toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
  const totalItems = o.items.reduce((s,i)=>s+(Number(i.qty)||0), 0);
  const resumen = o.items.slice(0,4).map(i => `${i.qty}× ${i.nombre}`).join(" · ")
    + (o.items.length > 4 ? ` · +${o.items.length - 4} más` : "");

  return `
    <article class="orden-card ${o.estado === "cobrada" ? "cobrada" : ""}" data-uid="${o.uid}">
      <div class="oc-head">
        <div class="oc-mesero">
          <i class="bi bi-person-fill"></i>
          <span>${escapeHtml(o.mesero)}</span>
        </div>
        <div class="oc-hora">
          <i class="bi bi-clock"></i> ${hora} · ${fecha}
        </div>
      </div>
      <div class="oc-resumen">${escapeHtml(resumen) || "Sin artículos"}</div>
      <div class="oc-foot">
        <div class="oc-total">
          <i class="bi bi-currency-dollar"></i>${o.total.toLocaleString("es-MX")}
          <small style="font-size:.68rem;color:var(--texto-suave);font-weight:600;margin-left:4px">
            (${totalItems} art.)
          </small>
        </div>
        <span class="oc-estado ${o.estado}">
          ${o.estado === "cobrada" ? "✓ Cobrada" : "Pendiente"}
        </span>
      </div>
    </article>`;
}

/* ============================================================
   🔍 DETALLE
   ============================================================ */
function abrirDetalle(o){
  if(!ordenSeleccionada || ordenSeleccionada.uid !== o.uid){
    $("#inputRecibido").value = "";
  }
  if(cobroReciente && cobroReciente.uid !== o.uid) cobroReciente = null;
  ordenSeleccionada = o;
  renderDetalle(o);
  $("#overlayDetalle").classList.add("open");
}

function cerrarDetalle(){
  ordenSeleccionada = null;
  $("#overlayDetalle").classList.remove("open");
}

function renderDetalle(o){
  const fecha = new Date(o.timestamp).toLocaleString("es-MX",{
    day:"2-digit", month:"long", hour:"2-digit", minute:"2-digit"
  });
  const totalItems = o.items.reduce((s,i)=>s+(Number(i.qty)||0), 0);

  $("#detalleBody").innerHTML = `
    <div class="detalle-meta">
      <div class="row"><span class="lbl">Mesero</span><span class="val">${escapeHtml(o.mesero)}</span></div>
      <div class="row"><span class="lbl">Fecha y hora</span><span class="val">${fecha}</span></div>
      <div class="row"><span class="lbl">Estado</span><span class="val">${o.estado === "cobrada" ? "✓ Cobrada" : "Pendiente"}</span></div>
    </div>
    <div class="detalle-items">
      ${o.items.map(i => `
        <div class="detalle-item">
          <div class="di-qty">${i.qty}</div>
          <div class="di-info">
            <div class="di-nombre">${escapeHtml(i.nombre)}</div>
            ${i.obs ? `<div class="di-obs"><i class="bi bi-chat-left-text"></i> ${escapeHtml(i.obs)}</div>` : ""}
          </div>
          <div class="di-precio">
            ${money(i.subtotal)}
            <small>${money(i.precio)} c/u</small>
          </div>
        </div>`).join("")}
    </div>
  `;

  $("#dArticulos").textContent = totalItems;
  $("#dTotal").textContent = money(o.total);

  const btn = $("#btnMarcarCobrada");
  if(o.estado === "cobrada"){
    btn.disabled = true;
    btn.classList.add("cobrada");
    btn.innerHTML = `<i class="bi bi-check2-circle"></i> Orden cobrada`;
  }else{
    btn.disabled = false;
    btn.classList.remove("cobrada");
    btn.innerHTML = `<i class="bi bi-cash-coin"></i> Marcar como cobrada`;
  }
  actualizarCambio();
}

/* ============================================================
   💵 EFECTIVO RECIBIDO Y CAMBIO
   ============================================================ */
/* Devuelve el monto escrito (en pesos) o null si está vacío/inválido */
function leerRecibido(){
  const txt = $("#inputRecibido").value.replace(/[$,\s]/g, "");
  if(txt === "") return null;
  const n = Number(txt);
  return isFinite(n) && n >= 0 ? redondear(n) : null;
}

function actualizarCambio(){
  const o = ordenSeleccionada;
  if(!o) return;

  const box = $("#pagoBox");
  const input = $("#inputRecibido");
  const cambioBox = $("#cambioBox");
  const btn = $("#btnMarcarCobrada");
  const cobrada = o.estado === "cobrada";

  // Orden ya cobrada: solo mostrar el cambio del cobro hecho en esta sesión
  if(cobrada){
    const c = cobroReciente && cobroReciente.uid === o.uid ? cobroReciente : null;
    box.classList.toggle("oculto", !c);
    input.disabled = true;
    $("#pagoRapido").hidden = true;
    if(c){
      input.value = String(c.recibido);
      cambioBox.className = "cambio ok";
      $("#cambioLbl").textContent = "Entregar cambio";
      $("#cambioVal").textContent = money2(c.cambio);
    }
    return;
  }

  box.classList.remove("oculto");
  input.disabled = false;
  $("#pagoRapido").hidden = false;

  const recibido = leerRecibido();
  if(recibido === null){
    cambioBox.className = "cambio";
    $("#cambioLbl").textContent = "Cambio";
    $("#cambioVal").textContent = "$0";
    btn.disabled = false;
    return;
  }

  const diff = redondear(recibido - o.total);
  btn.disabled = diff < 0;
  if(diff < 0){
    cambioBox.className = "cambio falta";
    $("#cambioLbl").textContent = "Faltan";
    $("#cambioVal").textContent = money2(-diff);
  }else{
    cambioBox.className = "cambio ok";
    $("#cambioLbl").textContent = "Entregar cambio";
    $("#cambioVal").textContent = money2(diff);
  }
}

/* ============================================================
   💰 MARCAR COMO COBRADA
   ============================================================ */
async function marcarCobrada(){
  if(!ordenSeleccionada) return;
  const orden = ordenSeleccionada;
  const btn = $("#btnMarcarCobrada");
  if(btn.disabled) return;

  // Capturar el pago antes de que el re-render bloquee el campo
  const recibido = leerRecibido();
  const cambio = recibido === null ? null : redondear(recibido - orden.total);
  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Guardando...`;

  // Actualizar localmente
  const idx = ordenes.findIndex(x => x.uid === orden.uid);
  if(idx !== -1) ordenes[idx].estado = "cobrada";
  guardarOrdenesLocales();

  // Enviar al backend (Apps Script debe soportar acción "cobrar")
  const ok = await notificarCobro(orden);

  cobroReciente = recibido === null ? null : { uid: orden.uid, recibido, cambio };

  renderResumen();
  renderLista();
  ordenSeleccionada = ordenes[idx];
  renderDetalle(ordenSeleccionada);

  const msgCambio = cambio !== null ? ` · Cambio ${money2(cambio)}` : "";
  toast((ok ? "Orden marcada como cobrada ✓" : "Cobrada localmente (sin conexión)") + msgCambio);
}

async function notificarCobro(orden){
  if(!GOOGLE_SHEETS_WEBAPP_URL || GOOGLE_SHEETS_WEBAPP_URL.includes("XXXX")) return true;
  try{
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({ accion: "cobrar", uid: orden.uid, timestamp: Date.now() })
    });
    return true;
  }catch(err){
    console.error("[Caja] Error al notificar cobro:", err);
    return false;
  }
}

/* ============================================================
   📈 ESTADÍSTICAS
   ------------------------------------------------------------
   Afluencia y productos se calculan sobre el historial de
   órdenes COBRADAS (1 orden = 1 visita). Los totales generales
   incluyen todas las órdenes tomadas.
   ============================================================ */
const DIAS_SEMANA = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

function abrirStats(){
  renderStats();
  $("#overlayStats").classList.add("open");
}

function cerrarStats(){
  $("#overlayStats").classList.remove("open");
}

function calcularStats(){
  const cobradas = ordenes.filter(o => o.estado === "cobrada");
  const porDia = Array(7).fill(0);   // 0 = lunes
  const porHora = Array(24).fill(0);
  const productos = new Map();       // clave en minúsculas → { nombre, qty }

  cobradas.forEach(o=>{
    const d = new Date(o.timestamp);
    porDia[(d.getDay() + 6) % 7]++;
    porHora[d.getHours()]++;
    o.items.forEach(i=>{
      const nombre = String(i.nombre ?? "").trim();
      const qty = Number(i.qty) || 0;
      if(!nombre || qty <= 0) return;
      const k = nombre.toLowerCase();
      const p = productos.get(k) || { nombre, qty: 0 };
      p.qty += qty;
      productos.set(k, p);
    });
  });

  return {
    todas: ordenes,
    cobradas,
    pendientes: ordenes.filter(o => o.estado === "pendiente"),
    porDia,
    porHora,
    ranking: [...productos.values()].sort((a,b)=> b.qty - a.qty || a.nombre.localeCompare(b.nombre, "es"))
  };
}

const sumaTotal = lista => lista.reduce((s,o)=>s+o.total, 0);

/* Nombres de los valores máximos (o mínimos) de un arreglo, con empates */
function extremos(arr, etiqueta, max = true){
  const vals = arr.filter(v => v > 0);
  if(!vals.length) return null;
  const objetivo = max ? Math.max(...vals) : Math.min(...vals);
  return {
    valor: objetivo,
    nombres: arr.map((v,i)=> v === objetivo ? etiqueta(i) : null).filter(Boolean)
  };
}

const etiquetaHora = h => `${String(h).padStart(2,"0")}:00–${String(h).padStart(2,"0")}:59`;

function barrasHTML(filas, maximo){
  return `<div class="barras">${filas.map(f=>`
    <div class="barra ${f.pico ? "pico" : ""}">
      <span class="nom" title="${escapeHtml(f.nombre)}">${escapeHtml(f.nombre)}</span>
      <span class="pista"><span class="rel" style="width:${maximo ? (f.valor / maximo * 100) : 0}%"></span></span>
      <span class="num">${f.valor}</span>
    </div>`).join("")}</div>`;
}

function renderStats(){
  const s = calcularStats();
  const hayCobradas = s.cobradas.length > 0;
  const plural = (n, a, b) => n === 1 ? a : b;

  // --- Día de la semana ---
  const diaTop = extremos(s.porDia, i => DIAS_SEMANA[i]);
  const maxDia = Math.max(...s.porDia);
  const diasHTML = hayCobradas ? `
    <div class="destacado"><i class="bi bi-calendar-check"></i>
      <span>Día más concurrido: <b>${escapeHtml(diaTop.nombres.join(" / "))}</b>
      (${diaTop.valor} ${plural(diaTop.valor, "orden", "órdenes")})</span></div>
    ${barrasHTML(DIAS_SEMANA.map((n,i)=>({ nombre:n, valor:s.porDia[i], pico:s.porDia[i] === maxDia })), maxDia)}`
    : `<div class="stats-vacio">Aún no hay órdenes cobradas.</div>`;

  // --- Horas pico (solo el rango de horas con actividad) ---
  const horasConDatos = s.porHora.map((v,h)=> v > 0 ? h : -1).filter(h => h >= 0);
  const horaTop = extremos(s.porHora, etiquetaHora);
  const maxHora = Math.max(...s.porHora);
  let horasHTML = `<div class="stats-vacio">Aún no hay órdenes cobradas.</div>`;
  if(hayCobradas){
    const desde = horasConDatos[0], hasta = horasConDatos[horasConDatos.length - 1];
    const filas = [];
    for(let h = desde; h <= hasta; h++){
      filas.push({ nombre: etiquetaHora(h), valor: s.porHora[h], pico: s.porHora[h] === maxHora });
    }
    horasHTML = `
      <div class="destacado"><i class="bi bi-clock-history"></i>
        <span>Hora pico: <b>${escapeHtml(horaTop.nombres.join(" / "))}</b>
        (${horaTop.valor} ${plural(horaTop.valor, "orden", "órdenes")})</span></div>
      ${barrasHTML(filas, maxHora)}`;
  }

  // --- Productos ---
  let productosHTML = `<div class="stats-vacio">Aún no hay productos cobrados.</div>`;
  if(s.ranking.length){
    const maxQty = s.ranking[0].qty;
    const minQty = s.ranking[s.ranking.length - 1].qty;
    const masPedidos = s.ranking.filter(p => p.qty === maxQty).map(p => p.nombre);
    const menosPedidos = s.ranking.filter(p => p.qty === minQty).map(p => p.nombre);
    productosHTML = `
      <div class="destacado"><i class="bi bi-trophy-fill"></i>
        <span>Más pedido: <b>${escapeHtml(masPedidos.join(" / "))}</b> (${maxQty} ${plural(maxQty, "pieza", "piezas")})</span></div>
      <div class="destacado menos"><i class="bi bi-arrow-down-circle"></i>
        <span>Menos pedido: <b>${escapeHtml(menosPedidos.join(" / "))}</b> (${minQty} ${plural(minQty, "pieza", "piezas")})</span></div>
      <div class="stats-nota">Ranking de todos los productos, de mayor a menor cantidad.</div>
      ${barrasHTML(s.ranking.map(p => ({ nombre:p.nombre, valor:p.qty, pico:p.qty === maxQty })), maxQty)}`;
  }

  $("#statsBody").innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="lbl">Órdenes tomadas</span>
        <span class="val">${s.todas.length}</span>
        <span class="sub">${money2(sumaTotal(s.todas))} en total</span>
      </div>
      <div class="stat-card verde">
        <span class="lbl">Total cobrado</span>
        <span class="val">${money2(sumaTotal(s.cobradas))}</span>
        <span class="sub">${s.cobradas.length} ${plural(s.cobradas.length, "orden cobrada", "órdenes cobradas")}</span>
      </div>
      <div class="stat-card" style="grid-column:1/-1">
        <span class="lbl">Por cobrar</span>
        <span class="val">${money2(sumaTotal(s.pendientes))}</span>
        <span class="sub">${s.pendientes.length} ${plural(s.pendientes.length, "orden pendiente", "órdenes pendientes")}</span>
      </div>
    </div>

    <section class="stats-sec">
      <h4><i class="bi bi-calendar-week"></i> Afluencia por día de la semana</h4>
      <div class="stats-nota">Órdenes cobradas por día (cada orden cuenta como un cliente).</div>
      ${diasHTML}
    </section>

    <section class="stats-sec">
      <h4><i class="bi bi-clock"></i> Horas pico</h4>
      <div class="stats-nota">Órdenes cobradas por hora del día.</div>
      ${horasHTML}
    </section>

    <section class="stats-sec">
      <h4><i class="bi bi-basket"></i> Productos más y menos pedidos</h4>
      ${productosHTML}
    </section>`;
}

/* ============================================================
   🔐 UTILIDADES
   ============================================================ */
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function actualizarConexion(){
  const online = navigator.onLine;
  const badge = $("#connBadge");
  badge.classList.toggle("offline", !online);
  $("#connTxt").textContent = online ? "Online" : "Offline";
  badge.querySelector("i").className = online ? "bi bi-wifi" : "bi bi-wifi-off";
}

/* ============================================================
   🚀 INICIALIZACIÓN
   ============================================================ */
function init(){
  // Filtros
  document.querySelectorAll(".filtro-btn").forEach(b=>{
    b.addEventListener("click", ()=>{
      document.querySelectorAll(".filtro-btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      filtroActivo = b.dataset.filtro;
      renderLista();
    });
  });

  // Cerrar detalle
  $("#btnCerrarDetalle").addEventListener("click", cerrarDetalle);
  $("#overlayDetalle").addEventListener("click", e=>{
    if(e.target.id === "overlayDetalle") cerrarDetalle();
  });

  // Estadísticas
  $("#btnStats").addEventListener("click", abrirStats);
  $("#btnCerrarStats").addEventListener("click", cerrarStats);
  $("#overlayStats").addEventListener("click", e=>{
    if(e.target.id === "overlayStats") cerrarStats();
  });

  // Marcar cobrada
  $("#btnMarcarCobrada").addEventListener("click", marcarCobrada);

  // Efectivo recibido: solo dígitos y punto, recalcula el cambio al escribir
  const inputRecibido = $("#inputRecibido");
  inputRecibido.addEventListener("input", ()=>{
    inputRecibido.value = inputRecibido.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    actualizarCambio();
  });
  inputRecibido.addEventListener("keydown", e=>{
    if(e.key === "Enter") marcarCobrada();
  });
  $("#pagoRapido").addEventListener("click", e=>{
    const b = e.target.closest("button[data-monto]");
    if(!b || !ordenSeleccionada) return;
    const m = b.dataset.monto === "exacto" ? ordenSeleccionada.total : b.dataset.monto;
    inputRecibido.value = String(m);
    actualizarCambio();
  });

  // Conexión
  window.addEventListener("online", actualizarConexion);
  window.addEventListener("offline", actualizarConexion);
  actualizarConexion();

  // Refresco inicial y automático
  refrescar(true);
  setInterval(()=>refrescar(true), REFRESH_INTERVAL);

  // Refrescar al volver a la pestaña
  document.addEventListener("visibilitychange", ()=>{
    if(!document.hidden) refrescar(true);
  });
}

document.addEventListener("DOMContentLoaded", init);