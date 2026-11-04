import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
let currentUser=null, options=[], participants=[], toastTimer=null, realtime=null;

function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function initials(n=""){return n.trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"?";}
function dateLabel(v){if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"short",year:"numeric"}).format(d);}
function toast(message,error=false){const el=$("adminToast");el.textContent=message;el.classList.toggle("error",error);el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3600);}
function setBusy(button,busy,label="Procesando…"){if(!button)return;button.disabled=busy;if(busy){button.dataset.old=button.textContent;button.textContent=label;}else if(button.dataset.old){button.textContent=button.dataset.old;delete button.dataset.old;}}
function isAdmin(user){return user?.app_metadata?.role==="admin";}
function showAuth(message=""){ $("authView").classList.remove("hidden");$("dashboardView").classList.add("hidden");$("logoutBtn").classList.add("hidden");$("loginMessage").textContent=message; }
function showDashboard(user){currentUser=user;$("authView").classList.add("hidden");$("dashboardView").classList.remove("hidden");$("logoutBtn").classList.remove("hidden");}
function optionName(id){return options.find(o=>o.id===id)?.name||"Opción no disponible";}

async function loadData(){
  const [o,p]=await Promise.all([
    supabase.from("options").select("id,name,created_at").order("created_at",{ascending:true}),
    supabase.from("participants").select("id,name,option_id,created_at").order("created_at",{ascending:false})
  ]);
  if(o.error||p.error) throw new Error(o.error?.message||p.error?.message);
  options=o.data||[];participants=p.data||[];
  renderAll();
}
function renderAll(){
  $("adminVotes").textContent=participants.length.toLocaleString("es-AR");
  $("adminParticipants").textContent=participants.length.toLocaleString("es-AR");
  $("adminOptions").textContent=options.length.toLocaleString("es-AR");
  $("optionCount").textContent=`${options.length} opciones`;
  $("adminRecordCount").textContent=`${participants.length} registros`;
  const selectHtml='<option value="">Seleccioná una opción</option>'+options.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  $("newParticipantOption").innerHTML=selectHtml;
  $("editOption").innerHTML=options.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  $("optionFilter").innerHTML='<option value="">Todas las opciones</option>'+options.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  renderOptions();renderParticipants();
}
function renderOptions(){
  $("optionsAdminList").innerHTML=options.length?options.map(o=>`<div class="manage-row"><strong>${esc(o.name)}</strong><div class="manage-actions"><button class="icon-button" type="button" data-edit-option="${esc(o.id)}" title="Editar opción" aria-label="Editar opción">✎</button><button class="icon-button delete" type="button" data-delete-option="${esc(o.id)}" title="Eliminar opción" aria-label="Eliminar opción">×</button></div></div>`).join(""):'<div class="empty-state">Todavía no hay opciones. Creá la primera.</div>';
}
function renderParticipants(){
  const q=$("adminSearch").value.trim().toLocaleLowerCase("es"),filter=$("optionFilter").value;
  const rows=participants.filter(p=>(!filter||p.option_id===filter)&&(p.name||"").toLocaleLowerCase("es").includes(q));
  $("adminRecordCount").textContent=`${rows.length} de ${participants.length} registros`;
  $("adminParticipantsBody").innerHTML=rows.length?rows.map(p=>`<tr><td class="person-cell"><span class="avatar">${esc(initials(p.name))}</span>${esc(p.name)}</td><td><span class="option-chip"><i></i>${esc(optionName(p.option_id))}</span></td><td class="date-cell">${dateLabel(p.created_at)}</td><td><div class="row-actions"><button class="button button-quiet" data-edit-participant="${esc(p.id)}" type="button">Editar</button><button class="button button-quiet" data-delete-participant="${esc(p.id)}" type="button" style="color:#ff8da2">Eliminar</button></div></td></tr>`).join(""):`<tr><td colspan="4" class="table-message">${participants.length?"No hay coincidencias.":"Todavía no hay participantes registrados."}</td></tr>`;
}
async function verifySession(){
  const {data:{session},error}=await supabase.auth.getSession();
  if(error)throw error;
  if(!session){showAuth();return;}
  if(!isAdmin(session.user)){
    await supabase.auth.signOut();
    showAuth("Esta cuenta no tiene permisos de administrador. Solicitá que se le asigne el rol admin en Supabase.");
    return;
  }
  showDashboard(session.user);
  await loadData();subscribe();
}
function subscribe(){
  if(realtime)supabase.removeChannel(realtime);
  realtime=supabase.channel("vota-pro-admin-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"options"},()=>loadData().catch(e=>toast("Error actualizando opciones: "+e.message,true)))
    .on("postgres_changes",{event:"*",schema:"public",table:"participants"},()=>loadData().catch(e=>toast("Error actualizando participantes: "+e.message,true)))
    .subscribe();
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const btn=$("loginBtn");setBusy(btn,true,"Verificando…");$("loginMessage").textContent="";
  try{
    const {data,error}=await supabase.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
    if(error)throw error;
    if(!isAdmin(data.user)){await supabase.auth.signOut();throw new Error("La cuenta inició sesión, pero no tiene el rol administrativo asignado.");}
    showDashboard(data.user);await loadData();subscribe();
  }catch(err){$("loginMessage").textContent=err.message||"No se pudo iniciar sesión.";}
  finally{setBusy(btn,false);}
});
$("logoutBtn").addEventListener("click",async()=>{
  const {error}=await supabase.auth.signOut();
  if(error){toast("No se pudo cerrar la sesión: "+error.message,true);return;}
  if(realtime)supabase.removeChannel(realtime);
  showAuth("Sesión cerrada correctamente.");
});
$("optionForm").addEventListener("submit",async e=>{
  e.preventDefault();const btn=e.submitter;const name=$("optionName").value.trim();
  if(!name){toast("Escribí un nombre para la opción.",true);return;}
  setBusy(btn,true,"Creando…");
  try{const {error}=await supabase.from("options").insert({name});if(error)throw error;$("optionName").value="";await loadData();toast("Opción creada correctamente.");}
  catch(err){toast("No se pudo crear la opción: "+err.message,true);}
  finally{setBusy(btn,false);}
});
$("participantForm").addEventListener("submit",async e=>{
  e.preventDefault();const btn=e.submitter,name=$("newParticipantName").value.trim(),option_id=$("newParticipantOption").value;
  if(!name||!option_id){toast("Completá el nombre y seleccioná una opción.",true);return;}
  setBusy(btn,true,"Guardando…");
  try{const {error}=await supabase.from("participants").insert({name,option_id});if(error)throw error;$("newParticipantName").value="";$("newParticipantOption").value="";await loadData();toast("Participante registrado correctamente.");}
  catch(err){toast("No se pudo registrar: "+err.message,true);}
  finally{setBusy(btn,false);}
});
$("optionsAdminList").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit-option]"),del=e.target.closest("[data-delete-option]");
  if(edit){
    const item=options.find(o=>o.id===edit.dataset.editOption);if(!item)return;
    const value=prompt("Nuevo nombre para la opción:",item.name);if(value===null)return;
    const name=value.trim();if(!name){toast("El nombre no puede estar vacío.",true);return;}
    try{const {error}=await supabase.from("options").update({name}).eq("id",item.id);if(error)throw error;await loadData();toast("Opción actualizada.");}
    catch(err){toast("No se pudo editar: "+err.message,true);}
  }
  if(del){
    const item=options.find(o=>o.id===del.dataset.deleteOption);if(!item)return;
    const count=participants.filter(p=>p.option_id===item.id).length;
    if(!confirm(`¿Eliminar la opción "${item.name}"?${count?`\n\nTiene ${count} participante(s) asignado(s). Para evitar perder registros, primero reasigná o eliminá esos participantes.`:" Esta acción no se puede deshacer."}`))return;
    if(count){toast("No se puede eliminar: primero reasigná o eliminá sus participantes.",true);return;}
    try{const {error}=await supabase.from("options").delete().eq("id",item.id);if(error)throw error;await loadData();toast("Opción eliminada.");}
    catch(err){toast("No se pudo eliminar: "+err.message,true);}
  }
});
$("adminParticipantsBody").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit-participant]"),del=e.target.closest("[data-delete-participant]");
  if(edit){
    const p=participants.find(x=>x.id===edit.dataset.editParticipant);if(!p)return;
    $("editId").value=p.id;$("editName").value=p.name;$("editOption").value=p.option_id||"";
    $("editTitle").textContent="Editar participante";$("editDialog").showModal();
  }
  if(del){
    const p=participants.find(x=>x.id===del.dataset.deleteParticipant);if(!p)return;
    if(!confirm(`¿Eliminar a "${p.name}"? Este registro se quitará de los resultados y no se puede recuperar.`))return;
    try{const {error}=await supabase.from("participants").delete().eq("id",p.id);if(error)throw error;await loadData();toast("Participante eliminado.");}
    catch(err){toast("No se pudo eliminar: "+err.message,true);}
  }
});
$("editForm").addEventListener("submit",async e=>{
  e.preventDefault();const id=$("editId").value,name=$("editName").value.trim(),option_id=$("editOption").value;
  if(!name||!option_id){toast("Completá todos los campos.",true);return;}
  try{const {error}=await supabase.from("participants").update({name,option_id}).eq("id",id);if(error)throw error;$("editDialog").close();await loadData();toast("Participante actualizado correctamente.");}
  catch(err){toast("No se pudo guardar: "+err.message,true);}
});
$("closeEdit").addEventListener("click",()=>$("editDialog").close());
$("cancelEdit").addEventListener("click",()=>$("editDialog").close());
$("adminSearch").addEventListener("input",renderParticipants);
$("optionFilter").addEventListener("change",renderParticipants);
supabase.auth.onAuthStateChange((_event,session)=>{
  if(!session){if(!$("authView").classList.contains("hidden"))return;showAuth("La sesión finalizó.");}
  else if(!isAdmin(session.user)){showAuth("La cuenta no tiene permisos administrativos.");}
});
verifySession().catch(err=>{console.error(err);showAuth("No se pudo iniciar el panel: "+err.message);});
