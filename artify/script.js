'use strict';
const $=id=>document.getElementById(id);
const ui={
    file:$('fileInput'),
    drop:$('dropZone'),
    original:$('originalPreview'),
    result:$('resultPreview'),
    strength:$('strength'),
    detail:$('detail'),
    strengthLabel:$('strengthLabel'),
    detailLabel:$('detailLabel'),
    auto:$('autoUpdate'),
    apply:$('applyBtn'),
    reset:$('resetBtn'),
    message:$('message'),
    dimensions:$('dimensions'),
    downloadFormat:$('downloadFormat'),
    downloadBtn:$('downloadBtn')
};
let sourceCanvas=null,resultCanvas=null,effect='sketch',sourceName='artify',pendingTimer=null,miniBusy=false;
const LIMIT=1350;
function status(s){
    ui.message.textContent=s;
}
function createCanvas(w,h){
    let c=document.createElement('canvas');
    c.width=w;
    c.height=h;
    return c;
}
function clamp(v){
    return Math.max(0,Math.min(255,v));
}
function grayscale(p){
    let g=new Float32Array(p.length/4);
    for(let i=0;i<g.length;i++){
        const j=i*4;
        g[i]=.299*p[j]+.587*p[j+1]+.114*p[j+2];
    }
    return g;
}
function blur(src,w,h,r){
    r=Math.max(1,Math.round(r));
    const out=new Float32Array(src.length),
    tmp=new Float32Array(src.length);
    const count=r*2+1;
    for(let y=0;y<h;y++){
        let sum=0;
        for(let k=-r;k<=r;k++)sum+=src[y*w+Math.max(0,Math.min(w-1,k))];
        for(let x=0;x<w;x++){
            tmp[y*w+x]=sum/count;
            sum-=src[y*w+Math.max(0,x-r)];
            sum+=src[y*w+Math.min(w-1,x+r+1)];
        }
    }
    for(let x=0;x<w;x++){
        let sum=0;
        for(let k=-r;k<=r;k++)sum+=tmp[Math.max(0,Math.min(h-1,k))*w+x];
        for(let y=0;y<h;y++){
            out[y*w+x]=sum/count;
            sum-=tmp[Math.max(0,y-r)*w+x];
            sum+=tmp[Math.min(h-1,y+r+1)*w+x];
        }
    }
    return out;
}
function edges(gray,w,h){
    const result=new Float32Array(gray.length);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const i=y*w+x;
        const a=gray[i-w-1],
        b=gray[i-w],
        c=gray[i-w+1],
        d=gray[i-1],
        f=gray[i+1],
        g=gray[i+w-1],
        h0=gray[i+w],
        j=gray[i+w+1];
        const gx=-a+c-2*d+2*f-g+j,
        gy=-a-2*b-c+g+2*h0+j;
        result[i]=Math.min(255,Math.hypot(gx,gy)/4);
    }
    return result;
}
function process(source,style,intensity,detail){
    const w=source.width,
    h=source.height;
    const src=source.getContext('2d',{
        willReadFrequently:true
    }).getImageData(0,0,w,h);
    const out=createCanvas(w,h),
    ctx=out.getContext('2d'),
    dest=ctx.createImageData(w,h);
    const p=src.data,
    q=dest.data,
    gray=grayscale(p);
    // Smooth noise before applying a Sobel edge detector.
    const smoothGray=blur(gray,w,h,1);
    const edge=edges(smoothGray,w,h);
    const power=.55+intensity*.45;
    // Even the default setting looks like a drawing.
    if(style==='sketch'){
        // Pencil sketch: grayscale + inverted-image blur + color dodge + graphite edges.
        // The blurred inversion's dodge denominator is the blurred ORIGINAL grayscale.
        const soft=blur(gray,w,h,Math.max(4,Math.round(5+intensity*11)));
        const small=blur(gray,w,h,1);
        for(let i=0;i<gray.length;i++){
            const j=i*4;
            const dodge=clamp(gray[i]*255/Math.max(1,soft[i]));
            // Light paper with fine, darker graphite contours and modest shading.
            const contour=clamp(Math.max(0,edge[i]-(16-detail*10))*(1.25+detail*1.8));
            const fineShade=Math.max(0,small[i]-gray[i])*.7;
            const pencil=clamp(dodge-contour-fineShade);
            const value=clamp(255-(255-pencil)*power);
            q[j]=q[j+1]=q[j+2]=value;
            q[j+3]=p[j+3];
        }
    }
    else{
        // Cartoon: smooth patches, posterize into a small number of colors, then ink edges.
        const r=new Float32Array(gray.length),
        g=new Float32Array(gray.length),
        b=new Float32Array(gray.length);
        for(let i=0;i<gray.length;i++){
            const j=i*4;
            r[i]=p[j];
            g[i]=p[j+1];
            b[i]=p[j+2];
        }
        const radius=Math.round(2+intensity*4);
        const rr=blur(r,w,h,radius),
        gg=blur(g,w,h,radius),
        bb=blur(b,w,h,radius);
        const levels=Math.max(4,Math.round(7-intensity*3));
        const threshold=16+detail*17;
        // Lower detail = more lines; higher = only prominent contours.
        for(let i=0;i<gray.length;i++){
            const j=i*4;
            const ink=clamp((edge[i]-threshold)*(3.7+intensity*3))/255;
            const line=1-ink*(.8+power*.2);
            const quant=v=>Math.round(clamp(v)/255*(levels-1))*255/(levels-1);
            const boost=v=>clamp((v-128)*1.14+128);
            q[j]=clamp(boost(quant(rr[i]))*line);
            q[j+1]=clamp(boost(quant(gg[i]))*line);
            q[j+2]=clamp(boost(quant(bb[i]))*line);
            q[j+3]=p[j+3];
        }
    }
    ctx.putImageData(dest,0,0);
    return out;
}
function placeCanvas(parent,canvas){
    parent.replaceChildren(canvas);
}
function copyCanvas(c){
    const copy=createCanvas(c.width,c.height);
    copy.getContext('2d').drawImage(c,0,0);
    return copy;
}
function fillMini(id,canvas){
    const mini=$(id);
    const c=copyCanvas(canvas);
    mini.replaceChildren(c);
}
function clearMini(){
    for(const [id,txt] of [['miniOriginal','Upload a photo to preview it'],['miniSketch','Pencil-style artwork'],['miniCartoon','Colorful cartoon artwork']]){
        $(id).innerHTML='<span>'+txt+'</span>';
    }
}
function reset(){
    clearTimeout(pendingTimer);
    sourceCanvas=null;
    resultCanvas=null;
    ui.file.value='';
    ui.original.innerHTML='<div class="empty-image"><span class="empty-illustration">✧</span><strong>Your photo appears here</strong><small>Choose a file to get started</small></div>';
    ui.result.innerHTML='<div class="empty-image"><span class="empty-illustration">✎</span><strong>Your art appears here</strong><small>Make something magical!</small></div>';
    clearMini();
    ui.apply.disabled=ui.reset.disabled=true;
    ui.downloadFormat.disabled=true;
    ui.downloadFormat.value='png';
    ui.downloadBtn.disabled=true;
    ui.dimensions.textContent='JPG, PNG and WEBP supported';
    status('Upload a photo to get started.');
}
async function loadFile(file){
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){
        status('Please choose a PNG, JPG or WebP image.');
        return;
    }
    if(file.size>25*1024*1024){
        status('Please choose an image under 25 MB.');
        return;
    }
    status('Loading image...');
    const url=URL.createObjectURL(file);
    try{
        const image=new Image();
        await new Promise((resolve,reject)=>{
            image.onload=resolve;image.onerror=reject;image.src=url;
        });
        const ratio=Math.min(1,LIMIT/Math.max(image.naturalWidth,image.naturalHeight));
        const w=Math.max(1,Math.round(image.naturalWidth*ratio)),
        h=Math.max(1,Math.round(image.naturalHeight*ratio));
        sourceCanvas=createCanvas(w,h);
        sourceCanvas.getContext('2d').drawImage(image,0,0,w,h);
        sourceName=file.name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_')||'artify';
        placeCanvas(ui.original,copyCanvas(sourceCanvas));
        fillMini('miniOriginal',sourceCanvas);
        ui.apply.disabled=ui.reset.disabled=false;
        ui.dimensions.textContent=`${image.naturalWidth} × ${image.naturalHeight} px`;
        status('Photo loaded. Creating your artwork...');
        generate(true);
        generateMinis();
    }
    catch(e){
        console.error(e);
        status('Could not open that photo. Try another image.');
    }
    finally{
        URL.revokeObjectURL(url);
    }
}
function addHistory(canvas){
    const list=$('historyItems');
    if(list.querySelector('.empty-history'))list.replaceChildren();
    const item=document.createElement('div');
    item.className='history-item';
    const img=new Image();
    const thumb=createCanvas(240,240);
    const ctx=thumb.getContext('2d');
    const scale=Math.min(240/canvas.width,240/canvas.height);
    ctx.drawImage(canvas,(240-canvas.width*scale)/2,(240-canvas.height*scale)/2,canvas.width*scale,canvas.height*scale);
    img.src=thumb.toDataURL('image/jpeg',.76);
    img.alt=`${effect} edited photo`;
    const label=document.createElement('p');
    label.textContent=`${sourceName} • ${effect}`;
    item.append(img,label);
    list.prepend(item);
    while(list.children.length>8)list.lastElementChild.remove();
}
function generate(silent=false){
    if(!sourceCanvas)return;
    clearTimeout(pendingTimer);
    ui.apply.disabled=true;
    status('Creating your artwork...');
    setTimeout(()=>{
        try{
            const result=process(sourceCanvas,effect,Number(ui.strength.value)/100,Number(ui.detail.value)/100);resultCanvas=result;placeCanvas(ui.result,result);ui.downloadFormat.disabled=false;ui.downloadBtn.disabled=false;status('Your artwork is ready! ✨');if(!silent)addHistory(result);
        }
        catch(e){
            console.error(e);status('Could not process this image. Try a smaller photo.');
        }
        finally{
            ui.apply.disabled=false;
        }
    },25);
}
function schedule(){
    if(!sourceCanvas||!ui.auto.checked)return;
    clearTimeout(pendingTimer);
    pendingTimer=setTimeout(()=>generate(),300);
}
function generateMinis(){
    if(!sourceCanvas||miniBusy)return;
    miniBusy=true;
    setTimeout(()=>{
        try{
            const ratio=Math.min(1,300/Math.max(sourceCanvas.width,sourceCanvas.height));const tiny=createCanvas(Math.round(sourceCanvas.width*ratio),Math.round(sourceCanvas.height*ratio));tiny.getContext('2d').drawImage(sourceCanvas,0,0,tiny.width,tiny.height);fillMini('miniSketch',process(tiny,'sketch',.9,.8));fillMini('miniCartoon',process(tiny,'cartoon',.9,.8));
        }
        catch(e){
            console.error(e)
        }
        finally{
            miniBusy=false;
        }
    },120);
}
function download(format){
    if(!resultCanvas)return;
    const mime={
        'png':'image/png',
        'jpeg':'image/jpeg',
        'webp':'image/webp'
    }
    [format];
    if(!mime)return;
    let canvas=resultCanvas;
    if(format==='jpeg'){
        canvas=createCanvas(resultCanvas.width,resultCanvas.height);
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#ffffff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(resultCanvas,0,0);
    }
    canvas.toBlob(blob=>{
        if(!blob){
            status('Export failed. Try PNG instead.');return;
        }
        const ext=format==='jpeg'?'jpg':format;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${sourceName}-${effect}.${ext}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);status(`${ext.toUpperCase()} download started!`);
    },mime,.92);
}
ui.file.addEventListener('change',e=>loadFile(e.target.files[0]));
ui.drop.addEventListener('dragover',e=>{
    e.preventDefault();ui.drop.classList.add('dragover');
});
ui.drop.addEventListener('dragleave',()=>ui.drop.classList.remove('dragover'));
ui.drop.addEventListener('drop',e=>{
    e.preventDefault();ui.drop.classList.remove('dragover');loadFile(e.dataTransfer.files[0]);
});
document.querySelectorAll('[data-effect]').forEach(b=>b.addEventListener('click',()=>{
    effect=b.dataset.effect;document.querySelectorAll('[data-effect]').forEach(x=>{
        x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));
    });$('intensityName').textContent=effect==='sketch'?'Sketch Intensity':'Cartoon Intensity';schedule();if(!ui.auto.checked&&sourceCanvas)status('Effect selected. Click Apply Effect.');
}));
for(const [control,label] of [[ui.strength,ui.strengthLabel],[ui.detail,ui.detailLabel]])control.addEventListener('input',()=>{
    label.textContent=`${control.value}%`;schedule();
});
ui.auto.addEventListener('change',()=>{
    if(ui.auto.checked)schedule();
});
ui.apply.addEventListener('click',()=>generate());
ui.reset.addEventListener('click',reset);
ui.downloadBtn.addEventListener('click',()=>download(ui.downloadFormat.value));
function activateView(){
    const hash=location.hash.replace('#','');
    const view=['home',
    'history',
    'about'].includes(hash)?hash:'home';
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active-view',el.id===view));
    document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    if(hash==='studio')$('studio').scrollIntoView({
        behavior:'smooth'
    });
}
window.addEventListener('hashchange',activateView);
activateView();
