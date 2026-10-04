// PDF object/xref writer adapted from the current exam site: aykuno/exam.kyoutu.selfcheck, kyoutu-ui-lab/pdf-export.js.
function makeTimetablePdf(jpeg) {
  const RASTER_W=1240, RASTER_H=1754;
  const ascii=text=>Uint8Array.from(text,c=>c.charCodeAt(0)&255);
  function makePdfBlob(jpegs){
    const pdfW=595.275590551, pdfH=841.88976378, parts=[], offsets=[0]; let len=0;
    function add(part){ if(typeof part==='string') part=ascii(part); parts.push(part); len += part.byteLength || part.length || 0; }
    function obj(n, body){ offsets[n]=len; add(n+' 0 obj\n'); body.forEach(add); add('\nendobj\n'); }
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const kids=[]; for(let i=0;i<jpegs.length;i++) kids.push((3+i*3)+' 0 R');
    obj(1,['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2,['<< /Type /Pages /Kids [',kids.join(' '),'] /Count ',String(jpegs.length),' >>']);
    for(let i=0;i<jpegs.length;i++){
      const page=3+i*3, content=page+1, image=page+2, name='Im'+(i+1);
      const stream='q\n'+pdfW.toFixed(3)+' 0 0 '+pdfH.toFixed(3)+' 0 0 cm\n/'+name+' Do\nQ\n';
      obj(page,['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ',pdfW.toFixed(3),' ',pdfH.toFixed(3),'] /Resources << /XObject << /',name,' ',image,' 0 R >> >> /Contents ',content,' 0 R >>']);
      obj(content,['<< /Length ',String(ascii(stream).length),' >>\nstream\n',stream,'endstream']);
      offsets[image]=len; add(image+' 0 obj\n');
      add('<< /Type /XObject /Subtype /Image /Width '+RASTER_W+' /Height '+RASTER_H+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpegs[i].length+' >>\nstream\n');
      add(jpegs[i]); add('\nendstream\nendobj\n');
    }
    const xref=len, maxObj=2+jpegs.length*3;
    add('xref\n0 '+(maxObj+1)+'\n0000000000 65535 f \n');
    for(let i=1;i<=maxObj;i++) add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    add('trailer\n<< /Size '+(maxObj+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
    return new Blob(parts,{type:'application/pdf'});
  }

  return makePdfBlob([jpeg]);
}
