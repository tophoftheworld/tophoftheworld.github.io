/* Offline UI fixture: never reads or writes production. */
(() => {
let rows=null, version=1;
const employees={one:{name:'Test One',nickname:'One'},two:{name:'Test Two',nickname:'Two'}};
window.ScheduleLive={
 async load(dates,today,presets){
   const next=new Date(today+'T12:00:00Z'); next.setUTCDate(next.getUTCDate()+1); const tomorrow=next.toISOString().slice(0,10);
   rows ||= [
     {id:'first',date:today,loc:'podium',employeeId:'one',type:'opening',start:'09:30',end:'18:30',role:'barista'},
     {id:'second',date:today,loc:'smnorth',employeeId:'one',type:'custom',start:'10:00',end:'19:00',role:'barista'},
     {id:'eventshift',date:today,loc:'creat8',employeeId:'two',type:'opening',start:'09:30',end:'18:30',role:'barista'},
     {id:'held',date:today,loc:'later',employeeId:'two',type:'closing',start:'13:00',end:'22:00',role:'barista'}
   ];
   return {employees,locations:[
     {id:'podium',name:'Podium',kind:'branch'},
     {id:'smnorth',name:'SM North',kind:'branch'},
     {id:'creat8',name:'Creat8 Stories Inc.',kind:'event',startDate:today+'T00:00:00.000Z',endDate:today+'T00:00:00.000Z'},
     {id:'later',name:'Later Event',kind:'event',startDate:tomorrow,endDate:tomorrow}
   ],shifts:structuredClone(rows.filter(s=>dates.includes(s.date))),attendance:[
     {id:'open',employeeId:'two',date:today,loc:'podium',shift:'Opening',timeIn:'9:59:00 AM',timeOut:null},
     {id:'closed',employeeId:'two',date:today,loc:'smnorth',shift:'Opening',timeIn:'9:30:00 AM',timeOut:'10:00:00 AM'}
   ]};
 },
 async save(before,after){rows=structuredClone(after);return rows.map(s=>({...s,_version:String(++version)}));}
};
})();
