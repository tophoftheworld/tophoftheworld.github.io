/* Live schedule shared by all views. */

(() => {

  const M = window.ScheduleMock;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const state = {view: ['week','day','people'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'week', day:M.TODAY, loc:'all', search:''};

  const person = id => M.EMPLOYEES[id] || {name:'Unassigned',nickname:'Unassigned',photoUrl:null};

  M.TODAY = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  state.day = M.TODAY;
  M.WEEK = weekDates();
  let busy=false;
  let collapsed=new Set();
  try { collapsed=new Set(JSON.parse(sessionStorage.getItem('schedule-collapsed') || '[]')); } catch {}
  let shifts = [], actual = [], loadedWeek = '', loading = false, loadError = '', requestId = 0;
  async function loadWeek(refresh=false) {
    const week = weekDates(), token = ++requestId;
    loadedWeek = week[0]; loading = true; loadError = ''; shifts = []; actual = [];
    render();
    try {
      const data = await window.ScheduleLive.load(week, M.TODAY, M.PRESETS,refresh);
      if (token !== requestId) return;
      M.EMPLOYEES = data.employees; M.LOCATIONS = data.locations;
      shifts = data.shifts;
      actual = data.attendance.map(a => ({...a,isActual:true,category:category(a.shift,a.timeIn)}));
    } catch (error) { if (token !== requestId) return; loadError = 'Could not load live data. Retry'; console.error(error); }
    loading = false; render();
  }

  const place = id => M.LOCATIONS.find(l => l.id === id)?.name || id;

  const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short', day:'numeric'});

  function addDays(date, amount) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0,10);
  }
  function weekDates() {
    const dow = new Date(state.day + 'T12:00:00Z').getUTCDay();
    const start = addDays(state.day, -(dow + 6) % 7);
    return Array.from({length:7},(_,i) => addDays(start,i));
  }
  const shortDate = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const weekday = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
  const time = t => { const [h,m] = t.split(':').map(Number); return `${h % 12 || 12}${':' + String(m).padStart(2,'0')} ${h < 12 ? 'am' : 'pm'}`; };

  const loggedTime = t => t ? t.replace(/:\d{2} (?=[AP]M)/, ' ').replace(' AM',' am').replace(' PM',' pm') : 'In progress';

  const avatar = (id, url = person(id).photoUrl, alt = '') => {

    const p = person(id);

    return `<span class="avatar"><span aria-hidden="true">${esc(p.nickname[0])}</span>${url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;

  };

  const visibleLocation = l => state.loc === 'all' || (state.loc === 'events' ? l.kind === 'event' : l.id === state.loc);

  const minutes = value => {

    const [h,m] = value.split(':').map(Number);

    if (/am|pm/i.test(value)) return (h % 12 + (/pm/i.test(value) ? 12 : 0)) * 60 + m;

    return h * 60 + m;

  };

  function category(type, start) {

    const key = String(type).toLowerCase();

    if (key === 'custom') return minutes(start) < 660 ? 'opening' : minutes(start) < 780 ? 'midshift' : 'closing';

    if (key.includes('opening')) return 'opening';

    if (key.includes('closing')) return 'closing';

    return 'midshift';

  }

  function visibleRows() {

  const scheduled = shifts.map(s => ({...M.PRESETS[s.type],...s})).filter(s => {

    if (s.date < M.TODAY) return false;

    if (s.date > M.TODAY || (s.role && s.role !== 'barista')) return true;

    return !actual.some(a => a.date === s.date && a.employeeId === s.employeeId && a.loc === s.loc && a.category === category(s.type,s.start));

  });

  return [...actual,...scheduled].sort((a,b) => Number(!!b.isActual) - Number(!!a.isActual) || minutes(a.timeIn || a.start) - minutes(b.timeIn || b.start));

  }

  function indicators(s) {
    const conflicts=window.ScheduleLogic.conflicts(s,shifts.map(r=>({...M.PRESETS[r.type],...r})));
    const late=window.ScheduleLogic.lateness(s,M.PRESETS);
    return (conflicts.length ? `<span class="shift-alert conflict" title="${esc(conflicts.map(r=>`${place(r.loc)} ${time(r.start)} – ${time(r.end)}`).join('; '))}">Overlapping shift</span>` : '')+(late ? `<span class="shift-alert ${late.severity}" title="Clocked in ${late.minutes} minutes after the ${esc(s.shift)} start">${late.minutes} min late</span>` : '');
  }
  const icon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{chevron:'<path d="m9 5 7 7-7 7"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>'}[name]}</svg>`;
  function downloadButton() { return `<button type="button" class="icon-action download-action" id="download-week" ${loading || loadError || busy ? 'disabled' : ''} aria-label="Download schedule image" title="Download schedule image">${icon('download')}</button>`; }
  function locationHeading(g,dates) {
    return `<div class="location-heading"><button type="button" class="section-toggle" data-collapse="${esc(g.id)}" aria-expanded="${!collapsed.has(g.id)}" aria-label="${collapsed.has(g.id)?'Expand':'Collapse'} ${esc(g.name)}"><span>${esc(g.name)}</span></button><button type="button" class="icon-action download-action" data-download="${esc(g.id)}" aria-label="Download ${esc(g.name)} schedule image" title="Download schedule image">${icon('download')}</button></div>${activeHours(g.id,dates)}`;
  }
  function crewSummary(rows, locationId) {
    const crew=[...new Map(rows.filter(s=>s.employeeId && s.employeeId!=='unassigned').map(s=>[s.employeeId,s])).values()];
    const open=rows.filter(s=>!s.employeeId || s.employeeId==='unassigned').length;
    const label=[crew.length ? `${crew.length} on duty` : '',open ? `${open} unassigned` : ''].filter(Boolean).join(' · ') || 'No shifts';
    const names=crew.map(s=>person(s.employeeId).name).join(', ');
    return `<button type="button" class="crew-summary" data-collapse="${esc(locationId)}" aria-label="Expand ${esc(place(locationId))}: ${esc(label)}${names ? ', '+esc(names) : ''}" title="${esc(names || label)}"><span class="crew-photos">${crew.slice(0,3).map(s=>avatar(s.employeeId,s.isActual ? s.timeInPhoto || person(s.employeeId).photoUrl : person(s.employeeId).photoUrl)).join('')}${crew.length>3 ? `<span class="crew-more">+${crew.length-3}</span>` : ''}</span><span class="crew-count">${esc(label)}</span></button>`;
  }
  function chip(s, showLocation) {

    const p = person(s.employeeId), label = s.isActual ? s.shift : M.PRESETS[s.type].label;

    const tag = 'button';

    return `<${tag} class="shift ${s.isActual ? 'actual' : 'scheduled'}" ${s.isActual ? `type="button" data-attendance="${s.id}" aria-label="View attendance photos for ${esc(p.name)}"` : `type="button" data-shift="${esc(s.id)}" aria-label="Edit shift for ${esc(p.name)}, ${esc(dayLabel(s.date))}"`} title="${esc(p.name)} · ${esc(place(s.loc))}">

      ${avatar(s.employeeId,s.isActual ? s.timeInPhoto : p.photoUrl,s.isActual ? 'Clock-in photo' : '')}

      <span class="shift-body">${showLocation ? '' : `<strong>${esc(p.nickname)}</strong>`}<span class="shift-name">${esc(label)}</span>

      ${showLocation ? `<span class="shift-location">${esc(place(s.loc))}</span>` : ''}

      ${s.isActual ? `<span class="shift-time">In ${loggedTime(s.timeIn)}</span><span class="shift-time">${s.timeOut ? 'Out ' + loggedTime(s.timeOut) : 'On shift'}</span>` : `<span class="shift-time">${time(s.start)}</span><span class="shift-time">– ${time(s.end)}</span>`}

      ${indicators(s)}</span></${tag}>`;

  }

  const photoDialog = document.getElementById('attendance-photos');

  let attendanceOpener;

  function showAttendance(id) {

    const record = actual.find(a => a.id === id);

    if (!record) return;

    attendanceOpener = document.activeElement;

    document.getElementById('attendance-name').textContent = person(record.employeeId).name;

    document.getElementById('attendance-context').textContent = `${dayLabel(record.date)} · ${place(record.loc)}`;

    document.getElementById('attendance-images').innerHTML = [['Clock in',record.timeIn,record.timeInPhoto],['Clock out',record.timeOut,record.timeOutPhoto]].map(([label,t,url]) => `<figure>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(label)} photo of ${esc(person(record.employeeId).name)}"></a>` : `<span class="photo-missing">${t ? 'No photo' : 'Not clocked out'}</span>`}<figcaption><strong>${label}</strong><span>${t ? loggedTime(t) : '—'}</span></figcaption></figure>`).join('');

    photoDialog.showModal();

  }

  document.getElementById('close-photos').addEventListener('click', () => photoDialog.close());

  photoDialog.addEventListener('close', () => attendanceOpener?.focus());

  const editor = document.getElementById('shift-editor');

  const form = document.getElementById('shift-form');

  const fields = form.elements;

  let editingId = null, editorOpener = null;

  function updateForm() {

    const preset = M.PRESETS[fields.type.value];
    if (preset?.start) { fields.start.value=preset.start; fields.end.value=preset.end; }
    fields.start.required = fields.end.required = true;
    document.getElementById('custom-role').hidden = fields.role.value !== 'custom';

    fields.customRole.required = fields.role.value === 'custom';

  }

  const personSearch=document.getElementById('shift-person-search'), personOptions=document.getElementById('person-options');
  let suggested=[], activeOption=-1;
  const selectedPerson=document.getElementById('selected-person'), personInput=personSearch.closest('.person-input');
  function syncPersonControl(searching=false) {
    const id=fields.employeeId.value, selected=!!id && !searching;
    selectedPerson.hidden=!selected; personInput.hidden=selected;
    if(selected) {
      selectedPerson.classList.toggle("has-person",id!=="unassigned");
      selectedPerson.innerHTML=`${id!=="unassigned" ? avatar(id) : ""}<span class="selected-person-name">${esc(person(id).name)}</span>`;
      selectedPerson.setAttribute('aria-label',`Change person: ${person(id).name}`);
    }
  }
  selectedPerson.addEventListener('click',()=>{personSearch.value='';showSuggestions(true);personSearch.focus();});
  const longDate=d=>d ? new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'}) : 'Choose date';
  function updateContext() {
    document.getElementById('shift-date-label').textContent=longDate(fields.date.value);
    document.getElementById('shift-context').textContent=`${fields.loc.value ? place(fields.loc.value) : 'Choose location'} · ${longDate(fields.date.value)}`;
  }
  function locationAvailable(l,date) { return l.kind==='branch' || (!l.cancelled && l.startDate && date>=l.startDate && date<=(l.endDate || l.startDate)); }
  function updateLocations(selected=fields.loc.value) {
    const locations=M.LOCATIONS.filter(l=>locationAvailable(l,fields.date.value));
    fields.loc.innerHTML='<option value="">Choose location / event</option>'+locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    fields.loc.value=locations.some(l=>l.id===selected) ? selected : '';
    updateContext();
  }
  function closeSuggestions() { if(personOptions.matches(':popover-open')) personOptions.hidePopover(); personOptions.hidden=true; personSearch.setAttribute('aria-expanded','false'); personSearch.removeAttribute('aria-activedescendant'); activeOption=-1; const refocus=document.activeElement===personSearch || personOptions.contains(document.activeElement); syncPersonControl(); if(refocus && !selectedPerson.hidden) selectedPerson.focus({preventScroll:true}); }
  function showSuggestions(all=false) {
    syncPersonControl(true);
    const query=all ? '' : personSearch.value.trim().toLowerCase();
    suggested=[['unassigned',person('unassigned')],...Object.entries(M.EMPLOYEES).filter(([id,p])=>!p.archived && p.active!==false || id===fields.employeeId.value)].filter(([id,p])=>`${p.name} ${p.nickname} ${id}`.toLowerCase().includes(query)).sort((a,b)=>a[1].name.localeCompare(b[1].name));
    activeOption=-1;
    personOptions.innerHTML=suggested.map(([id,p],i)=>`<button type="button" role="option" id="person-option-${i}" data-person-choice="${esc(id)}" aria-selected="${id===fields.employeeId.value}">${id!=="unassigned" ? avatar(id) : ""}<span>${esc(p.name)}</span></button>`).join('') || '<p>No matching people</p>';
    personOptions.hidden=false; if(!personOptions.matches(':popover-open')) personOptions.showPopover(); positionSuggestions(); personSearch.setAttribute('aria-expanded','true'); personSearch.removeAttribute('aria-activedescendant');
  }
  function positionSuggestions() {
    if(personOptions.hidden) return;
    const rect=personSearch.getBoundingClientRect(), viewport=window.visualViewport;
    const top=viewport?.offsetTop || 0, left=viewport?.offsetLeft || 0;
    const height=viewport?.height || window.innerHeight, width=viewport?.width || window.innerWidth;
    const below=Math.max(0,top+height-rect.bottom-12), above=Math.max(0,rect.top-top-12);
    const upwards=below<240 && above>below;
    personOptions.style.width=`${Math.min(rect.width,width-24)}px`;
    personOptions.style.maxHeight=`${Math.min(240,upwards ? above : below)}px`;
    personOptions.style.left=`${Math.max(left+12,Math.min(rect.left,left+width-personOptions.offsetWidth-12))}px`;
    personOptions.style.top=`${upwards ? rect.top-personOptions.offsetHeight-6 : rect.bottom+6}px`;
  }
  window.addEventListener('resize',positionSuggestions);
  document.addEventListener('scroll',e=>{if(!personOptions.contains(e.target)) positionSuggestions();},true);
  window.visualViewport?.addEventListener('resize',positionSuggestions);
  window.visualViewport?.addEventListener('scroll',positionSuggestions);
  editor.addEventListener('close',closeSuggestions);
  editor.addEventListener('cancel',e=>{if(!personOptions.hidden){e.preventDefault();closeSuggestions();}});
  personOptions.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();personSearch.focus();closeSuggestions();}});
  function choosePerson(id) { fields.employeeId.value=id; personSearch.value=person(id).name; closeSuggestions(); selectedPerson.focus({preventScroll:true}); }
  personSearch.addEventListener('focus',()=>showSuggestions(true));
  personSearch.addEventListener('input',()=>{fields.employeeId.value='';showSuggestions();});
  document.getElementById('person-toggle').addEventListener('click',()=>{if(personOptions.hidden){personSearch.focus();showSuggestions(true);}else closeSuggestions();});
  personOptions.addEventListener('click',e=>{const choice=e.target.closest('[data-person-choice]');if(choice) choosePerson(choice.dataset.personChoice);});
  personSearch.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !personOptions.hidden){e.preventDefault();e.stopPropagation();closeSuggestions();return;}
    if(e.key==='Tab'){closeSuggestions();return;}
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();if(personOptions.hidden) showSuggestions(true);
      if(!suggested.length) return;
      activeOption=(activeOption+(e.key==='ArrowDown'?1:-1)+suggested.length)%suggested.length;
      const options=personOptions.querySelectorAll('[role=option]');options.forEach((o,i)=>o.setAttribute('aria-selected',String(i===activeOption)));
      options[activeOption].scrollIntoView({block:'nearest'});personSearch.setAttribute('aria-activedescendant',options[activeOption].id);
    }
    if(e.key==='Enter' && !personOptions.hidden){e.preventDefault();if(activeOption>=0) choosePerson(suggested[activeOption][0]);}
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.person-combobox')) closeSuggestions();});
  fields.date.addEventListener('change',()=>updateLocations()); fields.loc.addEventListener('change',updateContext);
  for(const input of [fields.start,fields.end]) input.addEventListener('input',()=>{fields.type.value='custom';});
  for(const modal of [editor,photoDialog]) {
    let outside=false;
    const isOutside=e=>{const r=modal.getBoundingClientRect();return e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom;};
    modal.addEventListener('pointerdown',e=>{outside=e.target===modal && isOutside(e);});
    modal.addEventListener('click',e=>{if(!busy && outside && e.target===modal && isOutside(e)) modal.close();outside=false;});
  }

  function openEditor(id, defaults = {}) {

    const existing = shifts.find(s => s.id === id);

    if (id && !existing) return;

    editingId = id;

    editorOpener = document.activeElement;

    form.reset();

    const location = M.LOCATIONS.find(visibleLocation)?.id || M.LOCATIONS[0].id;

    const s = existing || {date:defaults.date || (state.day < M.TODAY ? M.TODAY : state.day),loc:defaults.loc || location,employeeId:defaults.employeeId || 'unassigned',type:'opening',role:'barista'};

    const options = (items, value) => items.map(([id,label]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(label)}</option>`).join('');

    fields.date.min = M.TODAY; fields.date.removeAttribute('max'); fields.date.value = s.date;

    updateLocations(s.loc);

    fields.type.innerHTML = options(Object.entries(M.PRESETS).map(([id,p]) => [id,p.label + (p.start ? ` (${time(p.start)} – ${time(p.end)})` : '')]),s.type);

    fields.employeeId.value=s.employeeId; personSearch.value=person(s.employeeId).name; closeSuggestions();

    fields.role.value = s.role || 'barista'; fields.customRole.value = s.customRole || '';

    fields.start.value = s.start || ''; fields.end.value = s.end || '';

    document.getElementById('shift-editor-title').textContent = id ? 'Edit shift' : 'Add shift';

    document.getElementById('delete-shift').hidden = !id;

    document.getElementById('shift-error').textContent = '';

    updateForm(); updateContext(); editor.showModal();

  }

  function status(message) { document.getElementById('action-status').textContent=message; }
  function lockForm(value) {
    busy=value;
    form.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);
    if(value) closeSuggestions();
  }
  async function commit(next,message,saved) {
    if(busy) return;
    const before=shifts;
    lockForm(true);document.getElementById('shift-error').textContent='';status('Saving…');
    try {
      const result=await window.ScheduleLive.save(before,next);
      shifts=result;
      if(saved){state.day=saved.date;state.loc='all';state.search='';document.getElementById('search').value='';}
      editor.close();status(message+' Saved to live schedule.');
      lockForm(false);await loadWeek(true);
    } catch(error) {
      document.getElementById('shift-error').textContent=error.message;
      status('Save not confirmed. Your form is still open.');
      lockForm(false);
    }
  }

  form.addEventListener('submit', e => {

    e.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    const preset = M.PRESETS[data.type];

    const s = {...shifts.find(s => s.id === editingId),...data,id:editingId || `shift_${crypto.randomUUID()}`,start:preset.start || data.start,end:preset.end || data.end};

    const error = document.getElementById('shift-error');

    if (!s.employeeId || (s.employeeId !== 'unassigned' && !M.EMPLOYEES[s.employeeId])) { error.textContent='Choose a person from the suggestions.'; personSearch.focus(); return; }
    if (!M.LOCATIONS.some(l=>l.id===s.loc && locationAvailable(l,s.date))) { error.textContent='Choose a location or event available on this date.'; return; }
    if (minutes(s.end) <= minutes(s.start)) { error.textContent = 'End time must be after start time.'; return; }

    if (s.employeeId !== 'unassigned' && shifts.some(other => {

      const p = {...M.PRESETS[other.type],...other};

      return p.id !== editingId && p.employeeId === s.employeeId && p.date === s.date && minutes(p.start) < minutes(s.end) && minutes(s.start) < minutes(p.end);

    })) { error.textContent = 'This person already has an overlapping shift on this date.'; return; }

    commit(editingId ? shifts.map(row => row.id === editingId ? s : row) : [...shifts,s],editingId ? 'Shift updated.' : 'Shift added.',s);

  });

  fields.type.addEventListener('change', updateForm); fields.role.addEventListener('change', updateForm);

  document.getElementById('add-shift').addEventListener('click', () => openEditor(null));

  document.querySelectorAll('[data-close-editor]').forEach(b => b.addEventListener('click', () => editor.close()));

  document.getElementById('delete-shift').addEventListener('click', () => { if(confirm('Delete this shift from the live schedule?')) commit(shifts.filter(s => s.id !== editingId),'Shift deleted.'); });
  editor.addEventListener('cancel',e=>{if(busy)e.preventDefault();});

  editor.addEventListener('close', () => { if (editorOpener?.isConnected) editorOpener.focus(); else document.getElementById('add-shift').focus(); });

  const minuteTime = n => time(`${Math.floor(n / 60)}:${String(n % 60).padStart(2,'0')}`);
  function assignedAt(location, dates) {
    return shifts.filter(s => s.loc === location && dates.includes(s.date) && s.employeeId !== 'unassigned').map(s => ({...M.PRESETS[s.type],...s}));
  }
  function activeHours(location, dates) {
    const list = assignedAt(location,dates);
    if (!list.length) return '<span class="active-hours">No assigned shifts</span>';
    return `<span class="active-hours">${minuteTime(Math.min(...list.map(s => minutes(s.start))))} – ${minuteTime(Math.max(...list.map(s => minutes(s.end))))}</span>`;
  }
  function renderTimeline(filtered, groups) {
    const list = filtered.filter(s => s.date === state.day);
    groups = groups.filter(g => g.kind === 'branch' || list.some(s => s.loc === g.id) || assignedAt(g.id,[state.day]).length);
    const planned = groups.flatMap(g => assignedAt(g.id,[state.day])).filter(s => `${person(s.employeeId).name} ${person(s.employeeId).nickname}`.toLowerCase().includes(state.search));
    const starts = [...planned.map(s => minutes(s.start)),...list.map(s => minutes(s.timeIn || s.start))];
    const ends = [...planned.map(s => minutes(s.end)),...list.map(s => s.isActual ? (s.timeOut ? minutes(s.timeOut) : minutes(s.timeIn) + 30) : minutes(s.end))];
    const start = starts.length ? Math.floor(Math.min(...starts)/60)*60 : 9*60;
    const end = Math.max(start+60,ends.length ? Math.ceil(Math.max(...ends)/60)*60 : 22*60);
    const ticks = Array.from({length:(end-start)/60+1},(_,i) => start+i*60);
    const percent = n => (n-start)/(end-start)*100;
    const lanes = groups.map(g => {
      const crew = collapsed.has(g.id) ? [] : list.filter(s => s.loc === g.id);
      const bars = crew.map((s,i) => {
        const from = minutes(s.timeIn || s.start), open = s.isActual && !s.timeOut;
        const to = s.isActual ? (s.timeOut ? minutes(s.timeOut) : from+30) : minutes(s.end);
        const range = s.isActual ? `${loggedTime(s.timeIn)} – ${s.timeOut ? loggedTime(s.timeOut) : 'On shift'}` : `${time(s.start)} – ${time(s.end)}`;
        return `<button type="button" class="timeline-bar ${s.isActual ? 'actual' : 'scheduled'} ${open ? 'ongoing' : ''}" style="--left:${percent(from)}%;--width:${percent(to)-percent(from)}%;--lane:${i}" ${s.isActual ? `data-attendance="${s.id}"` : `data-shift="${s.id}"`} aria-label="${s.isActual ? 'View attendance' : 'Edit shift'} for ${esc(person(s.employeeId).name)}: ${esc(range)}" title="${esc(range)}">${avatar(s.employeeId,s.isActual ? s.timeInPhoto : person(s.employeeId).photoUrl)}<strong>${esc(person(s.employeeId).nickname)}</strong><span class="shift-name">${esc(s.isActual ? s.shift : M.PRESETS[s.type].label)}</span><span>${esc(range)}</span>${indicators(s)}</button>`;
      }).join('');
      return `<div class="timeline-location">${locationHeading(g,[state.day])}</div><div class="timeline-track" style="--lanes:${Math.max(crew.length,1)}">${collapsed.has(g.id) ? crewSummary(list.filter(s=>s.loc===g.id),g.id) : bars || '<span class="timeline-empty">No shifts</span>'}${!collapsed.has(g.id) && state.day >= M.TODAY ? `<button type="button" class="cell-add timeline-add" data-add-date="${state.day}" data-location="${g.id}" aria-label="Add shift for ${esc(g.name)} on ${esc(dayLabel(state.day))}">+</button>` : ''}</div>`;
    }).join('');
    document.getElementById('schedule').innerHTML = `<div class="grid-wrap"><div class="timeline" style="--hours:${ticks.length-1}"><div class="timeline-key"><div class="corner-heading">Scheduled / logged</div></div><div class="timeline-axis">${ticks.map(t=>`<span style="left:${percent(t)}%">${minuteTime(t)}</span>`).join('')}</div>${lanes}</div></div>`;
  }
  function personDays(id, rows) {
    if (id === 'unassigned') return '';
    const days = new Set([...rows,...shifts.filter(s => weekDates().includes(s.date) && visibleLocation(M.LOCATIONS.find(l => l.id === s.loc)))].filter(s => s.employeeId === id).map(s => s.date)).size;
    return `<span class="person-days" title="Distinct dates with a scheduled shift or attendance in this week${state.loc === 'all' ? '' : ', for the selected location filter'}">${days} ${days === 1 ? 'day' : 'days'}${state.loc === 'all' ? '' : '<small>Selected locations</small>'}</span>`;
  }
  function render() {
    document.body.dataset.view = state.view;
    const week = weekDates();
    if (loadedWeek !== week[0]) { loadWeek(); return; }
    const currentWeek = week[0] === M.WEEK[0];
    document.getElementById('week-range').textContent = `${shortDate(week[0])} – ${shortDate(week[6])}, ${week[6].slice(0,4)}`;
    document.getElementById('period-title').textContent = state.view === 'day' ? new Date(state.day + 'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}) : currentWeek ? 'This week' : `Week of ${shortDate(week[0])}`;
    document.getElementById('period-date').value = state.day;
    document.getElementById('return-today').textContent = state.view === 'day' ? 'Today' : 'This week';
    document.getElementById('return-today').hidden = state.view === 'day' || currentWeek;
    document.getElementById('previous-period').setAttribute('aria-label', state.view === 'day' ? 'Previous day' : 'Previous week');
    document.getElementById('next-period').setAttribute('aria-label', state.view === 'day' ? 'Next day' : 'Next week');
    document.getElementById('snapshot-note').innerHTML = `${loading ? 'Loading live data...' : loadError || 'Live schedule'} ${downloadButton()}<button type="button" id="refresh-data" ${loading ? 'disabled' : ''}>${loadError ? 'Retry' : 'Refresh'}</button>`;
    document.getElementById('add-shift').disabled = loading || !!loadError || busy;


    document.getElementById('views').innerHTML = ['week','day','people'].map(v => `<button data-view="${v}" aria-pressed="${v === state.view}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');

    document.getElementById('filters').innerHTML = [{id:'all',name:'All locations'},...M.LOCATIONS.filter(l => l.kind === 'branch'),{id:'events',name:'Events'}].map(l => `<button data-loc="${l.id}" aria-pressed="${l.id === state.loc}">${esc(l.name)}</button>`).join('');

    document.getElementById('days').innerHTML = state.view === 'day' ? week.map(d => `<button class="day-pill ${d === M.TODAY ? 'is-today' : ''}" data-day="${d}" aria-label="${esc(dayLabel(d))}" aria-pressed="${d === state.day}"><span>${weekday(d)}</span><strong>${Number(d.slice(-2))}</strong>${d === M.TODAY ? '<small class="today-note">Today</small>' : '<small class="today-note" aria-hidden="true">&nbsp;</small>'}</button>`).join('') : '';

    if (loading || loadError) { document.getElementById('schedule').innerHTML = `<p role="status">${loading ? 'Loading schedules and attendance...' : 'Live data unavailable. Use Retry above.'}</p>`; return; }
    const filtered = visibleRows().filter(s => week.includes(s.date) && visibleLocation(M.LOCATIONS.find(l => l.id === s.loc)) && `${person(s.employeeId).name} ${person(s.employeeId).nickname}`.toLowerCase().includes(state.search));

    const dates = state.view === 'day' ? [state.day] : week, people = state.view === 'people';

    const groups = people ? [...Object.keys(M.EMPLOYEES),'unassigned'].filter(id => filtered.some(s => s.employeeId === id)).map(id => ({id,name:person(id).name})) : M.LOCATIONS.filter(l => visibleLocation(l) && (l.kind === 'branch' || filtered.some(s => s.loc === l.id) || assignedAt(l.id,week).length));

    if (state.view === 'day') { renderTimeline(filtered,groups); return; }

    const heads = dates.map(d => { const date = new Date(d + 'T12:00:00'); const dow = date.toLocaleDateString('en-US', {weekday:'short'}), n = date.getDate(); return `<button type="button" data-open-day="${d}" aria-label="View ${esc(dayLabel(d))}" class="date-head ${d === M.TODAY ? 'today' : ''}"><span>${dow}</span><strong>${n}</strong></button>`; }).join('');

    const cells = groups.map(g => `<div class="row-label">${people ? avatar(g.id) : ''}<span class="location-details">${people ? `<strong>${esc(g.name)}</strong>${personDays(g.id,filtered)}` : locationHeading(g,week)}</span></div>${dates.map(d => {

      if(!people && collapsed.has(g.id)) return `<div class="cell collapsed-cell ${d===M.TODAY ? 'today' : ''}">${crewSummary(filtered.filter(s=>s.date===d && s.loc===g.id),g.id)}</div>`;
      const list = filtered.filter(s => s.date === d && (people ? s.employeeId === g.id : s.loc === g.id));

      const largest = Math.max(...dates.map(date => filtered.filter(s => s.date === date && (people ? s.employeeId === g.id : s.loc === g.id)).length));
      return `<div class="cell ${d === M.TODAY ? 'today' : ''}">${list.map(s => chip(s,people)).join('')}${d >= M.TODAY ? `<button type="button" class="cell-add ${list.length < largest || !list.length ? 'card-add' : ''}" data-add-date="${d}" ${people ? `data-person="${g.id}"` : `data-location="${g.id}"`} aria-label="Add shift for ${esc(g.name)} on ${esc(dayLabel(d))}">+</button>` : ''}</div>`;

    }).join('')}`).join('');

    document.getElementById('schedule').innerHTML = `<div class="grid-wrap"><div class="schedule-grid ${state.view}" style="--days:${dates.length}"><div class="corner"><div class="corner-heading">${people ? 'People' : 'Location'}</div>${!people && !shifts.some(s=>week.includes(s.date)) ? `<button type="button" id="copy-week" class="copy-week" ${busy ? 'disabled' : ''}>${icon('copy')}Copy previous week</button>` : ''}</div>${heads}${cells || '<p class="no-results">No matching shifts</p>'}</div></div>`;

  }

  document.addEventListener('click', e => {

    const b = e.target.closest('button'); if (!b) return;

    if(b.dataset.collapse){ const id=b.dataset.collapse;collapsed.has(id)?collapsed.delete(id):collapsed.add(id);try { sessionStorage.setItem('schedule-collapsed',JSON.stringify([...collapsed])); } catch {} render();return; }
    if(b.id==='copy-week'){prepareCopy();return;}
    if(b.id==='download-week'){exportImage(null,b);return;}
    if(b.dataset.download){exportImage(b.dataset.download,b);return;}
    if (b.id === 'refresh-data') { loadWeek(true); return; }
    if (b.dataset.shift) { openEditor(b.dataset.shift); return; }

    if (b.dataset.addDate) { openEditor(null,{date:b.dataset.addDate,loc:b.dataset.location,employeeId:b.dataset.person}); return; }

    if (b.dataset.attendance) { showAttendance(b.dataset.attendance); return; }

    if (b.dataset.openDay) { state.day = b.dataset.openDay; state.view = 'day'; history.replaceState(null,'','#day'); render(); document.querySelector(`[data-day="${state.day}"]`)?.focus(); return; }
    if (!b.dataset.view && !b.dataset.loc && !b.dataset.day) return;

    if (b.dataset.view) { state.view = b.dataset.view; history.replaceState(null,'','#' + state.view); }

    if (b.dataset.loc) state.loc = b.dataset.loc;

    if (b.dataset.day) state.day = b.dataset.day;

    render();

    const selector = b.dataset.view ? `[data-view="${state.view}"]` : b.dataset.loc ? `[data-loc="${state.loc}"]` : `[data-day="${state.day}"]`;

    document.querySelector(selector)?.focus({preventScroll:true});

  });

  for (const [id,delta] of [['previous-period',-1],['next-period',1]]) {
    document.getElementById(id).addEventListener('click', () => {
      state.day = addDays(state.day, delta * (state.view === 'day' ? 1 : 7));
      render();
    });
  }
  document.getElementById('return-today').addEventListener('click', () => {state.day = M.TODAY; render();});
  document.getElementById('period-date').addEventListener('change', e => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {state.day = e.target.value; render();}
  });
  document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.hidden = true; },true);

  document.getElementById('search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); render(); });

  async function exportImage(locationId,button) {
    button.disabled=true;status('Preparing image…');
    try {
      const dates=weekDates();
      const selected=shifts.map(s=>({...M.PRESETS[s.type],...s})).filter(s=>dates.includes(s.date) && (locationId ? s.loc===locationId : visibleLocation(M.LOCATIONS.find(l=>l.id===s.loc))) && `${person(s.employeeId).name} ${person(s.employeeId).nickname}`.toLowerCase().includes(state.search));
      const locations=M.LOCATIONS.filter(l=>(locationId ? l.id===locationId : visibleLocation(l)) && (l.kind==='branch' || selected.some(s=>s.loc===l.id)));
      await window.downloadScheduleImage({dates,locations,shifts:selected,employees:M.EMPLOYEES,presets:M.PRESETS,title:locationId ? place(locationId) : 'Weekly schedule'});status('Schedule image downloaded.');
    }catch(error){status(error.message);}finally{button.disabled=false;}
  }
  const copyDialog=document.getElementById('copy-dialog');let copyPlan=null;
  document.getElementById('cancel-copy').addEventListener('click',()=>{if(!busy)copyDialog.close();});
  copyDialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  async function prepareCopy(){
    if(busy || shifts.some(s=>weekDates().includes(s.date)))return;busy=true;render();status('Reading previous week…');
    const dates=weekDates(), previous=dates.map(d=>addDays(d,-7));
    try {
      const [source,target]=await Promise.all([window.ScheduleLive.load(previous,M.TODAY,M.PRESETS,true,true),window.ScheduleLive.load(dates,M.TODAY,M.PRESETS,false,true)]);
      if(target.shifts.length){status('This week already has scheduled shifts. Copy is available only for empty weeks.');await loadWeek(true);return;}
      let skipped=0;
      const copied=source.shifts.flatMap(row=>{
        const date=addDays(row.date,7),location=target.locations.find(l=>l.id===row.loc);
        if(!location || !locationAvailable(location,date)){skipped++;return [];}
        return [{id:`shift_${crypto.randomUUID()}`,date,loc:row.loc,employeeId:row.employeeId,type:row.type,start:row.start,end:row.end,role:row.role || 'barista',customRole:row.customRole || ''}];
      });
      if(!copied.length){status('No eligible shifts to copy from the previous week.');return;}
      copyPlan={before:[],after:copied,day:dates[0]};
      document.getElementById('copy-summary').textContent=`Copy ${copied.length} shifts from ${shortDate(previous[0])} – ${shortDate(previous[6])} to ${shortDate(dates[0])} – ${shortDate(dates[6])}? This adds shifts across all locations to the empty week. Attendance is unchanged.${skipped ? ` ${skipped} event shifts are excluded because their events do not occur on the new dates.` : ''}`;
      document.getElementById('copy-error').textContent='';copyDialog.showModal();status('');
    }catch(error){status(error.message);}finally{busy=false;render();}
  }
  document.getElementById('confirm-copy').addEventListener('click',async()=>{
    if(busy || !copyPlan)return;busy=true;
    copyDialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const targetDates=Array.from({length:7},(_,i)=>addDays(copyPlan.day,i));const latest=await window.ScheduleLive.load(targetDates,M.TODAY,M.PRESETS,true,true);if(latest.shifts.length)throw new Error('This week now has scheduled shifts. Close this dialog and refresh before continuing.');await window.ScheduleLive.save(copyPlan.before,copyPlan.after);state.day=copyPlan.day;copyDialog.close();status('Previous week copied to the live schedule.');await loadWeek(true);}
    catch(error){document.getElementById('copy-error').textContent=error.message;}
    finally{busy=false;copyDialog.querySelectorAll('button').forEach(b=>b.disabled=false);render();}
  });

  render();

})();

