let quranTextPixels=19;
function setMobileTextZoom(element,scale){
 if(!element)return;
 let inner=element.querySelector(':scope > .mobile-text-content');
 if(!inner){const height=element.getBoundingClientRect().height||parseFloat(getComputedStyle(element).height)||200,base=parseFloat(getComputedStyle(element).fontSize);inner=document.createElement('span');inner.className='mobile-text-content';inner.dataset.baseFont=String(base);inner.textContent=element.textContent;element.replaceChildren(inner);element.style.height=height+'px';element.style.flex='none';element.classList.add('mobile-text-viewport');}
 const isQuran=element.matches('.quran-boundary p'),isHadith=element.id==='main-hadith-text',base=Number(inner.dataset.baseFont);
 const value=isHadith?Math.max(14/base,Math.min(32/base,scale)):isQuran?Math.max(16/base,Math.min(30/base,scale)):Math.max(1,Math.min(2.3,scale));inner.style.fontSize=(Number(inner.dataset.baseFont)*value)+'px';element.dataset.textZoom=String(value);if(isHadith)syncHadithFontControls();if(isQuran){quranTextPixels=base*value;syncQuranFontControls();}
}
function syncHadithFontControls(){
 const quote=document.getElementById('main-hadith-text');
 const base=Number(quote?.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(quote).fontSize);
 const pixels=base*(Number(quote.dataset.textZoom)||1);
 document.getElementById('btn-hadith-font-increase').disabled=pixels>=31.99;
 document.getElementById('btn-hadith-font-decrease').disabled=pixels<=14.01;
 document.getElementById('hadith-font-size').textContent='حجم الخط '+Math.round(pixels);
}
function syncQuranFontControls(){
 for(const button of document.querySelectorAll('[data-quran-font-step]'))button.disabled=Number(button.dataset.quranFontStep)>0?quranTextPixels>=29.99:quranTextPixels<=16.01;
}
function applyQuranTextSize(){
 for(const element of document.querySelectorAll('.quran-book-spread>.quran-boundary p')){
  const base=Number(element.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(element).fontSize);
  setMobileTextZoom(element,quranTextPixels/base);
 }
 syncQuranFontControls();
}
function initializeMobileInteractions(){
 for(const button of document.querySelectorAll('[data-quran-font-step]'))button.addEventListener('click',()=>{quranTextPixels=Math.min(30,Math.max(16,quranTextPixels+Number(button.dataset.quranFontStep)));applyQuranTextSize();});
 syncQuranFontControls();
 for(const [id,step] of [['btn-hadith-font-increase',2],['btn-hadith-font-decrease',-2]])document.getElementById(id).addEventListener('click',()=>{
   const quote=document.getElementById('main-hadith-text');
   const base=Number(quote.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(quote).fontSize);
   setMobileTextZoom(quote,((Number(quote.dataset.textZoom)||1)*base+step)/base);
 });
 syncHadithFontControls();
 let gesture=null;
 const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
 document.addEventListener('touchstart',event=>{if(event.touches.length!==2)return;const element=event.target.closest('.quran-boundary p,#main-hadith-text,.hadith-sharh-explanation,.lesson-title');if(element)gesture={element,start:distance(event.touches),scale:Number(element.dataset.textZoom)||1};},{passive:true});
 document.addEventListener('touchmove',event=>{if(!gesture||event.touches.length!==2)return;event.preventDefault();setMobileTextZoom(gesture.element,gesture.scale*distance(event.touches)/Math.max(1,gesture.start));},{passive:false});
 document.addEventListener('touchend',event=>{if(event.touches.length<2)gesture=null;},{passive:true});
}
