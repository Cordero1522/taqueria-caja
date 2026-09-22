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

const $ = (s, ctx=document) => ctx.querySelector(s);
const money = n => "$" + Number(n).toLocaleString("es-MX");

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
}

/* ============================================================
   💰 MARCAR COMO COBRADA
   ============================================================ */
async function marcarCobrada(){
  if(!ordenSeleccionada) return;
  const orden = ordenSeleccionada;
  const btn = $("#btnMarcarCobrada");
  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Guardando...`;

  // Actualizar localmente
  const idx = ordenes.findIndex(x => x.uid === orden.uid);
  if(idx !== -1) ordenes[idx].estado = "cobrada";
  guardarOrdenesLocales();

  // Enviar al backend (Apps Script debe soportar acción "cobrar")
  const ok = await notificarCobro(orden);

  renderResumen();
  renderLista();
  ordenSeleccionada = ordenes[idx];
  renderDetalle(ordenSeleccionada);

  toast(ok ? "Orden marcada como cobrada ✓" : "Cobrada localmente (sin conexión)");
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

  // Marcar cobrada
  $("#btnMarcarCobrada").addEventListener("click", marcarCobrada);

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