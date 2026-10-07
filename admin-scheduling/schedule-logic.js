/* Shared calculations, with no network or UI side effects. */
window.ScheduleLogic = {
  minutes(value) { const text=String(value || ''), parts=text.split(':'); let h=Number(parts[0]),m=parseInt(parts[1] || '0',10); if(/am|pm/i.test(text)) h=h%12+(/pm/i.test(text)?12:0); return h*60+m; },
  calendarDay(value) {
    const text=String(value ?? '').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if(!/^\d{4}-\d{2}-\d{2}T/.test(text)) return '';
    const date=new Date(text);
    if(Number.isNaN(date.getTime())) return text.slice(0,10);
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  },
  locationOpen(location, date) {
    if(!location) return false;
    if(location.kind==='branch') return true;
    if(location.cancelled) return false;
    const start=this.calendarDay(location.startDate);
    const end=this.calendarDay(location.endDate) || start;
    if(!start) return true;
    return date>=start && date<=end;
  },
  conflicts(shift,rows) {
    if(shift.isActual || !shift.employeeId || shift.employeeId==='unassigned') return [];
    const m=this.minutes;
    return rows.filter(s=>s.id!==shift.id && !s.isActual && s.employeeId===shift.employeeId && s.date===shift.date && m(s.start)<m(shift.end) && m(shift.start)<m(s.end));
  },
  lateness(record,presets) {
    if(!record.isActual || !record.timeIn) return null;
    const normalize=v=>String(v).toLowerCase().replace(/[^a-z]/g,'');
    const entry=Object.entries(presets).find(([key,p])=>normalize(key)===normalize(record.shift) || normalize(p.label)===normalize(record.shift));
    if(!entry || entry[0]==='custom' || !entry[1].start) return null;
    const delay=this.minutes(record.timeIn)-this.minutes(entry[1].start);
    return delay>=30 ? {minutes:delay,severity:delay>=60?'severe':'late'} : null;
  }
};
