/* Live scheduling reads and atomic, version-checked writes. Attendance is read-only. */
window.ScheduleLive = (() => {
  const root = 'projects/matchanese-attendance/databases/(default)/documents';
  const base = 'https://firestore.googleapis.com/v1/' + root;
  const decode = v => v.stringValue ?? v.booleanValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue) ?? v.timestampValue ?? (v.mapValue ? fields(v.mapValue.fields) : v.arrayValue ? (v.arrayValue.values || []).map(decode) : null);
  const fields = value => Object.fromEntries(Object.entries(value || {}).map(([k,v]) => [k,decode(v)]));
  const doc = d => ({...fields(d.fields),id:d.name.split('/').pop(),_path:d.name,_version:d.updateTime});
  async function request(path, body) {
    const response = await fetch(base + (path.startsWith(':') ? '' : '/') + path,{cache:'no-store',signal:AbortSignal.timeout(20000),...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Live scheduling request failed (${response.status})`);
    return response.json();
  }
  async function list(path, mask=[]) {
    let result=[], token='';
    do {
      const params = new URLSearchParams({pageSize:'300'});
      mask.forEach(field => params.append('mask.fieldPaths',field));
      if (token) params.set('pageToken',token);
      const data=await request(path+'?'+params);
      result.push(...(data.documents || []).map(doc)); token=data.nextPageToken;
    } while(token);
    return result;
  }
  async function parallel(items, fn) {
    const result=[]; let index=0;
    await Promise.all(Array.from({length:Math.min(8,items.length)},async()=>{while(index<items.length){const item=items[index++];result.push(...await fn(item));}}));
    return result;
  }
  const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  let metadata;
  const weeks = new Map();
  async function load(week,today,presets,refresh=false,schedulesOnly=false) {
    if (refresh) { metadata=null; weeks.clear(); }
    const cached=weeks.get(week[0]);
    if(cached && Date.now()-cached.at<120000) return structuredClone(cached.data);
    metadata ||= Promise.all([
      list('employees_v2',['name','nickname','photoUrl','active','archived']),
      list('branches',['name','key','type','archived','startDate','endDate','opsEventId']),
      list('opsEvents',['key','links','startDate','endDate','status'])
    ]).catch(error=>{metadata=null;throw error;});
    const [[staff,branches,events],buckets] = await Promise.all([
      metadata, parallel([-14,-7,0,7,14],offset=>list(`schedules/${addDays(week[0],offset)}/shifts`))
    ]);
    const employees=Object.fromEntries(staff.map(p=>[p.id,{...p,name:p.name || p.id,nickname:p.nickname || (p.name || p.id).split(' ')[0]}]));
    const locations=branches.filter(b=>!b.archived && b.key).map(b=>{
      const event=events.find(e=>e.id===b.opsEventId) || events.find(e=>e.links?.branchId===b.id) || events.find(e=>(e.links?.branchKey || e.key)===b.key && e.status!=='cancelled');
      const startDate=b.startDate || event?.startDate, endDate=b.endDate || event?.endDate || startDate;
      return {id:b.key,name:b.name || b.key,kind:['podium','smnorth'].includes(b.key) ? 'branch':'event',startDate,endDate,cancelled:event?.status==='cancelled'};
    });
    for(const [id,name] of [['smnorth','SM North'],['podium','Podium']]) if(!locations.some(l=>l.id===id)) locations.unshift({id,name,kind:'branch'});
    const ensureLocation=value=>{
      let location=locations.find(l=>l.id.toLowerCase()===String(value).toLowerCase() || l.name.toLowerCase()===String(value).toLowerCase());
      if(!location){location={id:value || 'unknown',name:value || 'Unknown',kind:'event'};locations.push(location);}
      return location.id;
    };
    const shifts=[...new Map(buckets.filter(s=>week.includes(s.date) && !s.id.startsWith('actual_')).map(s=>[s.id,s])).values()].map(s=>{
      const type=presets[s.type] ? s.type:'custom';
      return {...s,type,employeeId:s.employeeId || 'unassigned',loc:ensureLocation(s.branch),start:s.customStart || presets[type].start,end:s.customEnd || presets[type].end};
    }).filter(s=>s.start && s.end);
    const last=week[6]<today ? week[6]:today;
    const documents=schedulesOnly || week[0]>today ? [] : staff.flatMap(p=>week.filter(d=>d<=last).map(date=>`${root}/attendance_v2/${p.id}/dates/${date}`));
    const batches=Array.from({length:Math.ceil(documents.length/100)},(_,i)=>documents.slice(i*100,i*100+100));
    const records=await parallel(batches,async documents=>{
      const result=await request(':batchGet',{documents,mask:{fieldPaths:['clockIn','clockOut']}});
      return result.filter(r=>r.found).map(r=>r.found);
    });
    const attendance=records.map(raw=>{
      const a=doc(raw), employeeId=raw.name.split('/').at(-3);
      if(!a.clockIn?.time) return null;
      return {id:`logged-${employeeId}-${a.id}`,employeeId,date:a.id,loc:ensureLocation(a.clockIn.branch),
        shift:a.clockIn.shift || 'Custom',timeIn:a.clockIn.time,timeOut:a.clockOut?.time || null,
        timeInPhoto:a.clockIn.selfie || null,timeOutPhoto:a.clockOut?.selfie || null};
    }).filter(Boolean);
    const data={employees,locations,shifts,attendance};
    if(!schedulesOnly) weeks.set(week[0],{at:Date.now(),data:structuredClone(data)});
    return {employees,locations,shifts,attendance};
  }
  const weekKey=date=>addDays(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
  const pathFor=s=>`${root}/schedules/${weekKey(s.date)}/shifts/${s.id}`;
  function version(record) {
    if(record?.isActual || !record?._path?.startsWith(root+'/schedules/') || !record._path.endsWith('/shifts/'+record.id) || !record?._version) throw new Error('Refresh the schedule before changing this shift.');
    return {updateTime:record._version};
  }
  const encode=value=>value==null ? {nullValue:null} : {stringValue:String(value)};
  function buildWrites(before,after) {
    const writes=[];
    const previous=new Map(before.map(s=>[s.id,s]));
    const next=new Map(after.map(s=>[s.id,s]));
    for(const old of before) if(!next.has(old.id)) writes.push({delete:old._path,currentDocument:version(old)});
    for(const row of after) {
      const old=previous.get(row.id);
      if(old && JSON.stringify(old)===JSON.stringify(row)) continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.id || row.id.includes('/') || row.isActual || !row.loc || !row.employeeId) throw new Error('Invalid scheduled shift.');
      const name=pathFor(row);
      const moved=old && old._path!==name;
      if(moved) writes.push({delete:old._path,currentDocument:version(old)});
      const values={date:row.date,branch:row.loc,type:row.type,employeeId:row.employeeId,role:row.role || 'barista',customRole:row.role==='custom' ? row.customRole || '' : null,customStart:row.type==='custom' ? row.start : null,customEnd:row.type==='custom' ? row.end : null,createdAt:old?.createdAt || row.createdAt || new Date().toISOString()};
      writes.push({update:{name,fields:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,encode(v)]))},updateMask:{fieldPaths:Object.keys(values)},currentDocument:old && !moved ? version(old) : {exists:false},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]});
    }
    if(writes.length>500) throw new Error('This operation is too large to save atomically. Choose a smaller schedule.');
    return writes;
  }
  async function save(before,after) {
    const writes=buildWrites(before,after);
    if(!writes.length) return after;
    let result;
    try { result=await request(':commit',{writes}); }
    catch(error) { weeks.clear(); throw new Error('Save was not confirmed. Refresh before retrying; another admin may have changed the schedule or the connection failed.'); }
    weeks.clear();
    return after.map(s=>{const i=writes.findIndex(w=>w.update?.name===pathFor(s));return i<0 ? s : {...s,_path:pathFor(s),_version:result.writeResults[i].updateTime};});
  }
  return {load,save,buildWrites};
})();
