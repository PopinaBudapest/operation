// Operation Cost Planner — Supabase realtime (UMD build)
// Works from file:// and GitHub Pages.
// 1) Fill these constants. 2) Run the SQL (bottom) in Supabase. 3) Open index.html.

const SUPABASE_URL = "https://qqimeghjpamadwzhklzq.supabase.co";     // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxaW1lZ2hqcGFtYWR3emhrbHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxNDc1NjUsImV4cCI6MjA3MTcyMzU2NX0.yB8bz0vPtNt4t9xIzQs4l7kth2ehLtZrIvd4I48tUJU";
const DOC_ID = "global";                       // change to segment teams/boards
const SUPA_ENABLED = /^https?:\/\//.test(SUPABASE_URL);

// Use global UMD namespace
const supabase = SUPA_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const HOUR_START = 9;
const HOUR_END = 24; // exclusive
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START);
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const monthEl = $("#month");
const currencyEl = $("#currency");
const rentEl = $("#rent");
const extrasEl = $("#extras");
const elecOpRateEl = $("#elecOpRate");
const elecIdleRateEl = $("#elecIdleRate");
const elecPriceEl = $("#elecPrice");

const weeklyOpenEl = $("#weeklyOpen");
const monthlyOpenEl = $("#monthlyOpen");
const costPerHourEl = $("#costPerHour");

const calendarEl = $("#calendar");
const paletteEl = $("#palette");
const employeeListEl = $("#employeeList");
const summaryBoxEl = $("#summaryBox");

const exportBtn = $("#exportBtn");
const importFile = $("#importFile");

const modal = $("#workerModal");
const modalTitle = $("#modalTitle");
const wName = $("#wName");
const wRate = $("#wRate");
const wColor = $("#wColor");
const cancelAdd = $("#cancelAdd");
const confirmAdd = $("#confirmAdd");

let editingId = null;
let activeWorker = null;

let state = {
  v: 6,
  month: "",
  currency: "HUF",
  rent: 0,
  extras: 0,
  elecOpRate: 0,   // kWh per operating hour
  elecIdleRate: 0, // kWh per standby hour (closed hours)
  elecPrice: 0,    // currency per kWh
  employees: [],   // {id,name,rate,color}
  // schedule[day][hour] = Set(empId)
  schedule: Array.from({ length: 7 }, () => Array.from({ length: HOURS.length }, () => new Set())),
};

const CLIENT_ID = Math.random().toString(36).slice(2,10);
let suppressSave = false;
let lastServerVersion = 0;

// ---- LocalStorage fallback ----
const LS_KEY = "operationCostPlanner_v6";
function persistLocal(){
  const json = JSON.stringify(state, (k,v)=> v instanceof Set ? Array.from(v) : v);
  try { localStorage.setItem(LS_KEY, json); } catch {}
}
function restoreLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY); if(!raw) return;
    const data = JSON.parse(raw); state = Object.assign(state, data);
    ensureSetsRestored();
  }catch{}
}

// ---- Supabase helpers ----
async function fetchOrInit(){
  if (!SUPA_ENABLED) return;
  const { data, error } = await supabase.from("staffing_state").select("id,version,state").eq("id", DOC_ID).maybeSingle();
  if (error) { console.warn(error); return; }
  if (!data) {
    await saveToServer(true);
    return;
  }
  lastServerVersion = data.version || 0;
  applyRemoteState(data.state);
}
function subscribeRealtime(){
  if (!SUPA_ENABLED) return;
  supabase.channel("staffing_state_changes")
    .on("postgres_changes", { event:"UPDATE", schema:"public", table:"staffing_state", filter:`id=eq.${DOC_ID}` }, payload => {
      const row = payload.new; if (!row) return;
      if (row.version <= lastServerVersion) return;
      lastServerVersion = row.version;
      applyRemoteState(row.state);
    })
    .subscribe();
}
function serializeState(){
  return JSON.parse(JSON.stringify(state, (k,v)=> v instanceof Set ? Array.from(v) : v));
}
function ensureSetsRestored(){
  for (let di=0; di<7; di++) for (let hi=0; hi<HOURS.length; hi++) {
    const cell = state.schedule[di][hi];
    if (!(cell instanceof Set)) state.schedule[di][hi] = new Set(cell);
  }
}
async function saveToServer(isInsert=false){
  if (!SUPA_ENABLED) return;
  const payload = { id:DOC_ID, state: serializeState(), client_id: CLIENT_ID };
  const res = isInsert
    ? await supabase.from("staffing_state").insert(payload).select("version").single()
    : await supabase.from("staffing_state").update(payload).eq("id", DOC_ID).select("version").single();
  if (!res.error) lastServerVersion = res.data.version || lastServerVersion + 1;
}
let saveTimer=null; function scheduleSave(){ if(suppressSave) return; clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ saveToServer(false); persistLocal(); },400); }
function applyRemoteState(remote){
  suppressSave = true;
  try{
    state = remote || state; ensureSetsRestored();
    monthEl.value = state.month || monthEl.value;
    currencyEl.value = state.currency || currencyEl.value;
    rentEl.value = state.rent || 0;
    extrasEl.value = state.extras || 0;
    elecOpRateEl.value = state.elecOpRate || 0;
    elecIdleRateEl.value = state.elecIdleRate || 0;
    elecPriceEl.value = state.elecPrice || 0;
    buildCalendar(); renderPalette(); recalc();
    persistLocal();
  } finally { suppressSave = false; }
}

// ---- Calendar ----
function buildCalendar(){
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.appendChild(el("th",{text:""}));
  DAYS.forEach(d=> hr.appendChild(el("th",{text:d})));
  thead.appendChild(hr);

  const tbody = document.createElement("tbody");
  HOURS.forEach((h,hi)=>{
    const tr = document.createElement("tr");
    tr.appendChild(el("th",{text:`${String(h).padStart(2,"0")}:00`}));
    for (let di=0; di<7; di++){
      const td = document.createElement("td");
      td.dataset.day=String(di); td.dataset.hour=String(hi);
      const cell = document.createElement("div"); cell.className="cell";
      const dots = document.createElement("div"); dots.className="dots";
      cell.appendChild(dots); td.appendChild(cell); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  const tfoot = document.createElement("tfoot");
  const fr = document.createElement("tr");
  fr.appendChild(el("th",{text:"Profit target"}));
  for (let di=0; di<7; di++){
    const td = document.createElement("td");
    td.innerHTML = `<div class="profitbox"><div class="big" id="be_day_${di}">—</div><div id="be_hour_${di}">— / h</div></div>`;
    fr.appendChild(td);
  }
  tfoot.appendChild(fr);

  calendarEl.innerHTML="";
  calendarEl.append(thead, tbody, tfoot);

  attachPaintHandlers();
  renderCalendarDots();
}
function renderCalendarDots(){
  $$("#calendar td").forEach(td=>{
    if (!td.dataset.day) return;
    const di=+td.dataset.day, hi=+td.dataset.hour;
    const set = state.schedule[di][hi];
    const dots = td.querySelector(".dots"); if (!dots) return; dots.innerHTML="";
    Array.from(set).slice(0,8).forEach(empId=>{
      const emp = state.employees.find(e=>e.id===empId); if (!emp) return;
      const dot = document.createElement("div"); dot.className="dot-mini"; dot.style.background = emp.color; dots.appendChild(dot);
    });
  });
}
let painting=false, paintMode="add";
function attachPaintHandlers(){
  $$("#calendar tbody td").forEach(td=>{
    td.addEventListener("mousedown", e=>{
      if (!activeWorker) return;
      const di=+td.dataset.day, hi=+td.dataset.hour; const set = state.schedule[di][hi];
      paintMode = set.has(activeWorker) ? "remove" : "add";
      applyPaint(di,hi); painting=true; e.preventDefault();
    });
    td.addEventListener("mouseover", ()=>{ if(!painting) return; applyPaint(+td.dataset.day, +td.dataset.hour); });
  });
  document.addEventListener("mouseup", ()=> painting=false);
}
function applyPaint(di,hi){
  const set = state.schedule[di][hi];
  if (paintMode==="add") set.add(activeWorker); else set.delete(activeWorker);
  renderCalendarDots(); recalc(); scheduleSave();
}

function el(tag,opts={}){ const n=document.createElement(tag); if(opts.text!=null) n.textContent=opts.text; if(opts.html!=null) n.innerHTML=opts.html; if(opts.class) n.className=opts.class; return n; }

// ---- Palette & Employees ----
function renderPalette(){
  Array.from(paletteEl.querySelectorAll(".chip")).forEach(c=>c.remove());
  state.employees.forEach(emp=>{
    const chip = document.createElement("div"); chip.className="chip"; if (activeWorker===emp.id) chip.classList.add("active");
    const dot = document.createElement("div"); dot.className="dot"; dot.style.background = emp.color;
    const name = document.createElement("span"); name.textContent = emp.name;
    chip.append(dot,name); chip.addEventListener("click",()=>{ activeWorker=emp.id; renderPalette(); });
    paletteEl.appendChild(chip);
  });
}
function renderEmployeeList(monthStats){
  employeeListEl.innerHTML="";
  state.employees.forEach(emp=>{
    const monthlyHours = monthStats.perEmployeeHours[emp.id] || 0;
    const salary = monthlyHours * Number(emp.rate || 0);
    const card = el("div",{class:"emp-card"});
    const head = el("div",{class:"emp-head"});
    const tag = el("div",{class:"emp-tag"});
    const box = el("div",{class:"emp-border"}); box.style.borderColor = emp.color;
    const nm = el("div",{class:"emp-name",text:emp.name});
    tag.append(box,nm);
    const actions = el("div",{class:"emp-actions"});
    const mod = el("button",{class:"btn secondary",text:"Modify"}); mod.addEventListener("click",()=>openModal(emp));
    const del = el("button",{class:"btn danger",text:"Delete"}); del.addEventListener("click",()=>deleteEmployee(emp.id));
    actions.append(mod,del); head.append(tag,actions);
    const meta = el("div",{class:"emp-meta",html:`Rate: <b>${fmtMoney(emp.rate)}</b> ${state.currency}/h`});
    const stats = el("div",{class:"emp-meta",html:`Monthly hours: <b>${monthlyHours.toFixed(2)}</b> · Salary: <b>${fmtMoney(salary)}</b> ${state.currency}`});
    card.append(head,meta,stats); employeeListEl.appendChild(card);
  });
}
function deleteEmployee(id){
  state.employees = state.employees.filter(e=>e.id!==id);
  if (activeWorker===id) activeWorker=null;
  for (let di=0; di<7; di++) for (let hi=0; hi<HOURS.length; hi++) state.schedule[di][hi].delete(id);
  renderPalette(); renderCalendarDots(); recalc(); scheduleSave();
}

// ---- Stats + Summary ----
function weekdayCounts(year,monthIndex){
  const counts=[0,0,0,0,0,0,0];
  const daysInMonth = new Date(year, monthIndex+1, 0).getDate();
  for (let d=1; d<=daysInMonth; d++){
    const wd = new Date(year, monthIndex, d).getDay();
    const idx = wd===0 ? 6 : wd-1; counts[idx]++;
  }
  return counts;
}
function computeStats(){
  let weeklyOpen=0; for (let di=0; di<7; di++) for (let hi=0; hi<HOURS.length; hi++) if (state.schedule[di][hi].size>0) weeklyOpen++;
  const [y,m] = state.month ? state.month.split("-").map(Number) : [NaN,NaN];
  let monthlyOpen=0, counts=null; const perEmployeeHours={}; const dayOpenHours=new Array(7).fill(0); let daysInMonth=0;
  if (isFinite(y) && isFinite(m)){
    counts = weekdayCounts(y, m-1);
    daysInMonth = counts.reduce((a,c)=>a+c,0);
    for (let di=0; di<7; di++){
      let dayOpen=0; const dayEmp={};
      for (let hi=0; hi<HOURS.length; hi++){
        const set = state.schedule[di][hi];
        if (set.size>0) dayOpen++;
        set.forEach(empId => dayEmp[empId]=(dayEmp[empId]||0)+1);
      }
      dayOpenHours[di]=dayOpen;
      monthlyOpen += dayOpen * counts[di];
      Object.entries(dayEmp).forEach(([empId,h])=>{ perEmployeeHours[empId]=(perEmployeeHours[empId]||0)+ h*counts[di]; });
    }
  }
  return { weeklyOpen, monthlyOpen, perEmployeeHours, counts, dayOpenHours, daysInMonth };
}
function fmtMoney(n){ return !isFinite(n) ? "—" : new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n); }

function recalc(){
  state.month = monthEl.value;
  state.currency = currencyEl.value || state.currency;
  state.rent = Number(rentEl.value || 0);
  state.extras = Number(extrasEl.value || 0);
  state.elecOpRate = Number(elecOpRateEl.value || 0);
  state.elecIdleRate = Number(elecIdleRateEl.value || 0);
  state.elecPrice = Number(elecPriceEl.value || 0);

  const stats = computeStats();
  weeklyOpenEl.textContent = `${stats.weeklyOpen.toFixed(2)} h`;
  monthlyOpenEl.textContent = `${stats.monthlyOpen.toFixed(2)} h`;

  // Standby hours = ALL closed hours (24h days minus open hours)
  const monthlyStandby = Math.max(0, (stats.daysInMonth||0) * 24 - stats.monthlyOpen);

  // Salaries (monthly)
  let totalSalaries = 0; state.employees.forEach(e=>{ const hrs = stats.perEmployeeHours[e.id] || 0; totalSalaries += hrs * Number(e.rate || 0); });

  // Electricity (monthly)
  const opKWh = state.elecOpRate * stats.monthlyOpen;
  const idleKWh = state.elecIdleRate * monthlyStandby;
  const totKWh = opKWh + idleKWh;
  const elecCost = totKWh * state.elecPrice;

  // Totals & CPH (monthly)
  const totalFixed = state.rent + state.extras;
  const totalMonthly = totalFixed + totalSalaries + elecCost;
  const cph = stats.monthlyOpen > 0 ? totalMonthly / stats.monthlyOpen : NaN;
  costPerHourEl.textContent = isFinite(cph) ? `${fmtMoney(cph)} ${state.currency} / h` : "—";

  // Per-day break-even (all monthly costs must be covered only by open hours)
  // If there are no open hours in the month, show dashes.
  if (!(stats.monthlyOpen > 0)) {
    for (let di = 0; di < 7; di++) {
      const dayEl = document.getElementById(`be_day_${di}`);
      const hourEl = document.getElementById(`be_hour_${di}`);
      if (dayEl) dayEl.textContent = "—";
      if (hourEl) hourEl.textContent = "— / h";
    }
  } else {
    const cphAllIn = totalMonthly / stats.monthlyOpen; // includes fixed, salaries, op+standby electricity
    for (let di = 0; di < 7; di++) {
      const dayOpen = stats.dayOpenHours[di] || 0;
      const dayCost = dayOpen * cphAllIn;
      const dayEl = document.getElementById(`be_day_${di}`);
      const hourEl = document.getElementById(`be_hour_${di}`);
      if (dayEl) dayEl.textContent = `${fmtMoney(dayCost)} ${state.currency}`;
      if (hourEl) hourEl.textContent = `${fmtMoney(cphAllIn)} ${state.currency} / h`;
    }
  }

  // Employees
  renderEmployeeList(stats);

  // Summary card
  const wkParts = stats.counts ? stats.counts.map((c,i)=>`${DAYS[i]}×${c}`).join(" · ") : "";
  summaryBoxEl.innerHTML = [
    ["Weekday counts", wkParts || "—"],
    ["Operating hours (month)", `${stats.monthlyOpen.toFixed(2)} h`],
    ["Standby hours (month)", `${monthlyStandby.toFixed(2)} h`],
    ["Electricity — operating kWh", `${opKWh.toFixed(2)} kWh`],
    ["Electricity — standby kWh", `${idleKWh.toFixed(2)} kWh`],
    ["Electricity — total kWh", `${totKWh.toFixed(2)} kWh`],
    ["Electricity cost", `${fmtMoney(elecCost)} ${state.currency}`],
    ["Salaries (month)", `${fmtMoney(totalSalaries)} ${state.currency}`],
    ["Fixed costs (rent + extras)", `${fmtMoney(totalFixed)} ${state.currency}`],
    ["Total monthly cost", `${fmtMoney(totalMonthly)} ${state.currency}`],
    ["Cost per open hour", isFinite(cph) ? `${fmtMoney(cph)} ${state.currency} / h` : "—"]
  ].map(([l,v])=>`<div class="summary-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");

  persistLocal();
  if (!suppressSave) scheduleSave();
}

exportBtn.addEventListener("click",()=>{
  const blob = new Blob([JSON.stringify(serializeState(), null, 2)], { type:"application/json" });
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="operation-cost-planner.json"; document.body.appendChild(a); a.click(); a.remove();
});
importFile.addEventListener("change",(e)=>{
  const file = e.target.files?.[0]; if(!file) return; const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const data = JSON.parse(reader.result);
      if (!data.schedule || !data.employees) throw new Error("Invalid file");
      suppressSave=true; state = data; ensureSetsRestored();
      monthEl.value = state.month || monthEl.value; currencyEl.value = state.currency || currencyEl.value;
      rentEl.value = state.rent || 0; extrasEl.value = state.extras || 0;
      elecOpRateEl.value = state.elecOpRate || 0; elecIdleRateEl.value = state.elecIdleRate || 0; elecPriceEl.value = state.elecPrice || 0;
      buildCalendar(); renderPalette(); recalc();
    } catch(err){ alert("Import failed: "+err.message); }
    finally{ suppressSave=false; await saveToServer(false); }
  };
  reader.readAsText(file);
});

// Modal (Add/Edit)
$("#addWorkerBtn").addEventListener("click",()=>openModal());
cancelAdd.addEventListener("click",()=>closeModal());
confirmAdd.addEventListener("click",()=>{
  const name=(wName.value||"").trim(); const rate=Number(wRate.value||0); const color=wColor.value||"#06b6d4";
  if(!name){ wName.focus(); return; }
  if (editingId){ const obj=state.employees.find(e=>e.id===editingId); if(obj){ obj.name=name; obj.rate=rate; obj.color=color; } }
  else { const emp={ id: uid(), name, rate, color }; state.employees.push(emp); activeWorker=emp.id; }
  closeModal(); renderPalette(); recalc(); scheduleSave();
});
function openModal(emp=null){ editingId=emp?.id||null; modalTitle.textContent = editingId?"Modify worker":"Add worker"; wName.value=emp?.name||""; wRate.value=(emp?.rate!=null)?String(emp.rate):""; wColor.value=emp?.color||"#06b6d4"; modal.style.display="flex"; setTimeout(()=>wName.focus(),50); }
function closeModal(){ modal.style.display="none"; editingId=null; }

function initDefaultsIfEmpty(){
  if (!state.month){ const now=new Date(); monthEl.value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; state.month=monthEl.value; } else { monthEl.value=state.month; }
  currencyEl.value = state.currency || "HUF";
  rentEl.value = state.rent || 0; extrasEl.value = state.extras || 0;
  elecOpRateEl.value = state.elecOpRate || 0; elecIdleRateEl.value = state.elecIdleRate || 0; elecPriceEl.value = state.elecPrice || 0;
  // No default employees on purpose
}
function hookInputs(){ [monthEl,currencyEl,rentEl,extrasEl,elecOpRateEl,elecIdleRateEl,elecPriceEl].forEach(el=> el.addEventListener("input",()=>{ recalc(); scheduleSave(); })); }
function uid(){ return Math.random().toString(36).slice(2,10); }

// Boot
restoreLocal();
initDefaultsIfEmpty();
buildCalendar();
renderPalette();
hookInputs();
recalc();
fetchOrInit();
subscribeRealtime();

/* --- Supabase SQL (run in SQL editor) ---
create table if not exists public.staffing_state (
  id text primary key,
  version bigint generated by default as identity,
  state jsonb not null,
  client_id text,
  updated_at timestamptz default now()
);
alter table public.staffing_state enable row level security;
create policy "Allow read" on public.staffing_state for select using (true);
create policy "Allow upsert" on public.staffing_state for insert with check (true);
create policy "Allow update" on public.staffing_state for update using (true);
*/
