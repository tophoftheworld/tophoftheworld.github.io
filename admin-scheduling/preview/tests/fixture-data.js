/* Offline UI fixture: never reads or writes production. */
(() => {
let rows=null, version=1;
const employees={one:{name:'Test One',nickname:'One'},two:{name:'Test Two',nickname:'Two'}};
window.ScheduleLive={
 async load(dates,today,presets){
   rows ||= [
     {id:'first',date:today,loc:'podium',employeeId:'one',type:'opening',start:'09:30',end:'18:30',role:'barista'},
     {id:'second',date:today,loc:'smnorth',employeeId:'one',type:'custom',start:'10:00',end:'19:00',role:'barista'}
   ];
   return {employees,locations:[{id:'podium',name:'Podium',kind:'branch'},{id:'smnorth',name:'SM North',kind:'branch'}],shifts:structuredClone(rows.filter(s=>dates.includes(s.date))),attendance:[]};
 },
 async save(before,after){rows=structuredClone(after);return rows.map(s=>({...s,_version:String(++version)}));}
};
})();
