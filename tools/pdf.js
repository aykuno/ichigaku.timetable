// PDF object/xref writer adapted from aykuno/exam.kyoutu.selfcheck.
function makeTimetablePdf(raster,options={}) {
  const width=options.width||1240,height=options.height||1754,encoding=options.encoding||'jpeg';
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>10000000)throw Error('Invalid raster dimensions');
  if(encoding!=='jpeg'&&encoding!=='rgb-deflate')throw Error('Unsupported raster encoding');
  const ascii=text=>Uint8Array.from(text,c=>c.charCodeAt(0)&255);
  const pdfW=595.275590551,pdfH=841.88976378,parts=[],offsets=[0];let length=0;
  function add(part){if(typeof part==='string'||typeof part==='number')part=ascii(String(part));parts.push(part);length+=part.byteLength;}
  function obj(n,body){offsets[n]=length;add(n+' 0 obj\n');body.forEach(add);add('\nendobj\n');}
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2,['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  obj(3,['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ',pdfW.toFixed(3),' ',pdfH.toFixed(3),'] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>']);
  const stream='q\n'+pdfW.toFixed(3)+' 0 0 '+pdfH.toFixed(3)+' 0 0 cm\n/Im1 Do\nQ\n';
  obj(4,['<< /Length ',String(ascii(stream).length),' >>\nstream\n',stream,'endstream']);
  obj(5,['<< /Type /XObject /Subtype /Image /Width ',width,' /Height ',height,' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /',encoding==='rgb-deflate'?'FlateDecode':'DCTDecode',' /Length ',raster.byteLength,' >>\nstream\n',raster,'\nendstream']);
  const xref=length;add('xref\n0 6\n0000000000 65535 f \n');
  for(let i=1;i<=5;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
  return new Blob(parts,{type:'application/pdf'});
}
