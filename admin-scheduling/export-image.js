window.downloadScheduleImage = async ({dates,locations,shifts,employees,presets,title}) => {
  const width=1740,labelWidth=220,col=(width-labelWidth-20)/7,cardHeight=102;
  const groups=locations.map(l=>({...l,rows:dates.map(d=>shifts.filter(s=>s.loc===l.id && s.date===d).sort((a,b)=>a.start.localeCompare(b.start)))}));
  const heights=groups.map(g=>Math.max(1,...g.rows.map(r=>r.length))*cardHeight+20);
  const height=170+heights.reduce((a,b)=>a+b,0)+30;
  if(height>16000) throw new Error('Choose a single location to download a smaller image.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const c=canvas.getContext('2d');
  const box=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
  const text=(value,x,y,max,font='16px Arial',color='#213429')=>{c.font=font;c.fillStyle=color;let v=String(value);while(c.measureText(v).width>max && v.length>1) v=v.slice(0,-2)+'…';c.fillText(v,x,y);};
  const time=v=>{const [h,m]=v.split(':').map(Number);return `${h%12 || 12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`;};
  const photoIds=[...new Set(shifts.map(s=>s.employeeId))];const photos=new Map();
  await Promise.all(photoIds.map(id=>new Promise(resolve=>{const src=employees[id]?.photoUrl;if(!src){resolve();return;}const img=new Image();img.crossOrigin='anonymous';const timer=setTimeout(()=>resolve(),5000);img.onload=()=>{clearTimeout(timer);photos.set(id,img);resolve();};img.onerror=()=>{clearTimeout(timer);resolve();};img.src=src;})));
  box(0,0,width,height,'#eef4ef');text(title,24,44,width-48,'bold 28px Arial');text(`${new Date(dates[0]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${new Date(dates[6]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · Scheduled shifts`,24,77,width-48);
  box(20,100,width-40,60,'#ffffff');
  dates.forEach((d,i)=>text(new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),labelWidth+i*col+10,138,col-20,'bold 17px Arial'));
  let y=170;
  groups.forEach((g,index)=>{
    box(20,y,width-40,heights[index]-4,'#fff');text(g.name,30,y+29,labelWidth-50,'bold 17px Arial');
    g.rows.forEach((rows,day)=>rows.forEach((s,n)=>{
      const x=labelWidth+day*col+5,cy=y+8+n*cardHeight,p=employees[s.employeeId],image=photos.get(s.employeeId);
      c.fillStyle='#1f7a38';c.beginPath();c.roundRect(x,cy,col-10,cardHeight-8,9);c.fill();
      c.save();c.beginPath();c.arc(x+25,cy+25,17,0,Math.PI*2);c.clip();box(x+8,cy+8,34,34,'#dceade');
      if(image){const size=Math.min(image.width,image.height);c.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,x+8,cy+8,34,34);}else text((p?.nickname || p?.name || 'U')[0],x+19,cy+31,22,'bold 18px Arial');c.restore();
      text(p?.nickname || p?.name || 'Unassigned',x+48,cy+28,col-66,'bold 16px Arial','#fff');
      const shiftLabel=presets[s.type]?.label || 'Custom';
      c.font='bold 12px Arial';
      const pillWidth=Math.min(col-30,c.measureText(shiftLabel).width+16);
      c.fillStyle='#e1efe5';c.beginPath();c.roundRect(x+10,cy+44,pillWidth,20,10);c.fill();
      text(shiftLabel,x+18,cy+58,pillWidth-16,'bold 12px Arial','#195e2d');
      text(`${time(s.start)} – ${time(s.end)}`,x+10,cy+84,col-30,'14px Arial','#fff');
    }));y+=heights[index];
  });
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob) throw new Error('Image could not be generated.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`schedule-${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${dates[0]}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
