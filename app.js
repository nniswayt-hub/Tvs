import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
const palette = ["#8b6cff","#43d9ed","#628dff","#e78bff","#57d6a1","#ffb86b","#ed7299","#9ba8ff"];
let options = [], participants = [], chart = null, realtime = null;

function escapeHTML(value="") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initials(name="") { return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase() || "?"; }
function dateLabel(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"short",year:"numeric"}).format(d);
}
function showError(message) {
  const el=$("pageMessage"); el.textContent=message; el.style.display="block";
}
function setUpdated() {
  $("lastUpdated").textContent = "Actualizado: " + new Intl.DateTimeFormat("es-AR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date());
}
function totals() {
  const counts = options.map(o => ({...o, votes:participants.filter(p=>p.option_id===o.id).length}));
  return {counts,total:participants.length};
}
function renderStats() {
  $("totalVotes").textContent = participants.length.toLocaleString("es-AR");
  $("totalParticipants").textContent = participants.length.toLocaleString("es-AR");
  $("totalOptions").textContent = options.length.toLocaleString("es-AR");
  $("chartTotal").textContent = participants.length.toLocaleString("es-AR");
}
function renderChart(counts,total) {
  const canvas=$("votesChart");
  if (!canvas || !window.Chart) return;
  const labels=counts.map(x=>x.name);
  const data=counts.map(x=>x.votes);
  const colors=counts.map((_,i)=>palette[i%palette.length]);
  if(chart) chart.destroy();
  chart=new Chart(canvas,{type:"doughnut",data:{labels,datasets:[{data,backgroundColor:colors,borderColor:"#11182a",borderWidth:4,hoverOffset:9,spacing:2}]},options:{responsive:true,maintainAspectRatio:false,cutout:"72%",plugins:{legend:{display:false},tooltip:{backgroundColor:"#11192c",titleColor:"#fff",bodyColor:"#cbd4ef",padding:12,displayColors:true,callbacks:{label:c=>` ${c.label}: ${c.raw} votos (${total?Math.round(c.raw/total*100):0}%)`}}},animation:{duration:850}}});
  $("chartLegend").innerHTML=counts.length ? counts.map((x,i)=>`<div class="legend-item"><i class="legend-dot" style="background:${colors[i]}"></i><span>${escapeHTML(x.name)}</span><strong>${total?Math.round(x.votes/total*100):0}%</strong></div>`).join("") : '<div class="empty-inline">Todavía no hay opciones creadas.</div>';
}
function renderRanking(counts,total) {
  const sorted=[...counts].sort((a,b)=>b.votes-a.votes || a.name.localeCompare(b.name));
  $("rankingList").innerHTML=sorted.length ? sorted.map((o,i)=> {
    const pct=total?o.votes/total*100:0;
    return `<div class="rank-item"><div class="rank-top"><div class="rank-name"><span class="rank-number">${String(i+1).padStart(2,"0")}</span><strong>${escapeHTML(o.name)}</strong></div><span class="rank-result">${o.votes} <span style="color:#7784a4;font-weight:500">· ${Math.round(pct)}%</span></span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;
  }).join("") : '<div class="empty-state">No hay opciones para mostrar. El administrador puede crear la primera.</div>';
}
function renderParticipants() {
  const query=$("participantSearch").value.trim().toLocaleLowerCase("es");
  const optionMap=new Map(options.map(o=>[o.id,o.name]));
  const filtered=participants.filter(p=>String(p.name).toLocaleLowerCase("es").includes(query) || String(optionMap.get(p.option_id)||"").toLocaleLowerCase("es").includes(query));
  $("participantCount").textContent=`${filtered.length} de ${participants.length} registros`;
  $("participantsBody").innerHTML=filtered.length ? filtered.map(p=>`<tr><td class="person-cell"><span class="avatar">${escapeHTML(initials(p.name))}</span>${escapeHTML(p.name)}</td><td><span class="option-chip"><i></i>${escapeHTML(optionMap.get(p.option_id)||"Opción no disponible")}</span></td><td class="date-cell">${dateLabel(p.created_at)}</td></tr>`).join("") : `<tr><td colspan="3" class="table-message">${participants.length?"No se encontraron participantes.":"Todavía no hay participantes registrados."}</td></tr>`;
}
async function loadData() {
  const [o,p]=await Promise.all([
    supabase.from("options").select("id,name,created_at").order("created_at",{ascending:true}),
    supabase.from("participants").select("id,name,option_id,created_at").order("created_at",{ascending:false})
  ]);
  if(o.error || p.error) throw new Error(o.error?.message || p.error?.message);
  options=o.data||[]; participants=p.data||[];
  const {counts,total}=totals();
  renderStats(); renderChart(counts,total); renderRanking(counts,total); renderParticipants(); setUpdated();
}
function subscribe() {
  if(realtime) supabase.removeChannel(realtime);
  realtime=supabase.channel("vota-pro-public-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"options"},()=>loadData().catch(e=>showError("No se pudieron actualizar las opciones: "+e.message)))
    .on("postgres_changes",{event:"*",schema:"public",table:"participants"},()=>loadData().catch(e=>showError("No se pudieron actualizar los participantes: "+e.message)))
    .subscribe(status=>{
      if(status==="CHANNEL_ERROR" || status==="TIMED_OUT") showError("La sincronización en vivo se interrumpió. Se volverá a intentar automáticamente.");
    });
}
$("participantSearch").addEventListener("input",renderParticipants);
(async()=>{
  try {
    await loadData();
    subscribe();
  } catch(error) {
    console.error(error);
    showError("No se pudo conectar con Supabase. Revisá la configuración y ejecutá schema.sql. Detalle: "+error.message);
    $("participantsBody").innerHTML='<tr><td colspan="3" class="table-message">No se pudieron cargar los datos. Verificá la conexión e intentá nuevamente.</td></tr>';
    $("rankingList").innerHTML='<div class="empty-state">No se pudieron cargar los resultados.</div>';
    $("chartLegend").innerHTML='<div class="empty-inline">Sin conexión a la base de datos.</div>';
  }
})();
