// PDF object/xref writer adapted from aykuno/exam.kyoutu.selfcheck.
function makeTimetablePdf(raster,options={}) {
  const pages=options.pages||[{raster,width:options.width||1240,height:options.height||1754,encoding:options.encoding||'jpeg'}];
  if(!Array.isArray(pages)||pages.length<1||pages.length>2)throw Error('Invalid page count');
  for(const page of pages){
    const {width,height,encoding}=page;
    if(!(page.raster instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>10000000)throw Error('Invalid raster dimensions');
    if(encoding!=='jpeg'&&encoding!=='rgb-deflate')throw Error('Unsupported raster encoding');
  }
  const ascii=text=>Uint8Array.from(text,c=>c.charCodeAt(0)&255);
  const hexText=text=>'FEFF'+Array.from({length:text.length},(_,i)=>text.charCodeAt(i).toString(16).padStart(4,'0')).join('').toUpperCase();
  const pdfW=595.275590551,pdfH=841.88976378,parts=[],offsets=[0];let length=0;
  function add(part){if(typeof part==='string'||typeof part==='number')part=ascii(String(part));parts.push(part);length+=part.byteLength;}
  function obj(n,body){offsets[n]=length;add(n+' 0 obj\n');body.forEach(add);add('\nendobj\n');}
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,['<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>']);
  obj(2,['<< /Type /Pages /Kids [',pages.map((_,i)=>(3+i*3)+' 0 R').join(' '),'] /Count ',pages.length,' >>']);
  pages.forEach((page,i)=>{
    const number=3+i*3;
    obj(number,['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ',pdfW.toFixed(3),' ',pdfH.toFixed(3),'] /Resources << /XObject << /Im1 ',number+2,' 0 R >> >> /Contents ',number+1,' 0 R >>']);
    const stream='q\n'+pdfW.toFixed(3)+' 0 0 '+pdfH.toFixed(3)+' 0 0 cm\n/Im1 Do\nQ\n';
    obj(number+1,['<< /Length ',String(ascii(stream).length),' >>\nstream\n',stream,'endstream']);
    obj(number+2,['<< /Type /XObject /Subtype /Image /Width ',page.width,' /Height ',page.height,' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /',page.encoding==='rgb-deflate'?'FlateDecode':'DCTDecode',' /Length ',page.raster.byteLength,' >>\nstream\n',page.raster,'\nendstream']);
  });
  const info=3+pages.length*3;
  obj(info,['<< /Title <',hexText(String(options.title||'2026時間割')),'> /Producer (Ichigaku timetable) >>']);
  const count=info+1,xref=length;add('xref\n0 '+count+'\n0000000000 65535 f \n');
  for(let i=1;i<count;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  add('trailer\n<< /Size '+count+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xref+'\n%%EOF');
  return new Blob(parts,{type:'application/pdf'});
}
