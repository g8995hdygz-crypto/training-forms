'use strict';
const $=id=>document.getElementById(id);let forms=[],current=null,answers={},extraRows={},notes='',sheetIndex=0,dirty=false,imports=new Map();
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n};
function message(text){$('message').textContent=text}
function key(ref,sheet=sheetIndex){return sheet+':'+ref}
function rosters(f,si){
 const rows=f.sheets[si].rows,out=[];
 rows.forEach((row,i)=>{const labels=row.map(c=>c.label.trim());
 if(!labels.includes('성명')||!labels.some(t=>['면허번호','경력','담당업무'].includes(t)))return;
 let end=i+1;while(end<rows.length&&rows[end].every(c=>!c.label)&&rows[end].some(c=>c.input))end++;
 if(end===i+1)return;
 const template=rows[i+1].filter(c=>c.input),columns=template.map(c=>c.ref.replace(/\d+/,''));
 if(template.some(c=>c.span[0]!==1)||rows.slice(i+1,end).some(r=>r.filter(c=>c.input).map(c=>c.ref.replace(/\d+/,'')).join()!==columns.join()))return;
 const title=(rows[i-1]||[]).map(c=>c.label).filter(Boolean).join(' ')||'명단';
 out.push({id:si+':'+row[0].ref,header:row[0].ref,title,start:i,end:end-1,template,columns,labels:row.filter(c=>c.label).map(c=>c.label),width:row.reduce((n,c)=>n+c.span[1],0)});
 });return out;
}
function extraRef(b,id,col){return 'repeat-'+b.header+'-'+id+'-'+col}
function allowed(f,extras={}){const a=new Set();f.sheets.forEach((s,i)=>s.rows.forEach(r=>r.forEach(c=>{if(c.input||c.check)a.add(i+':'+c.ref)})));f.sheets.forEach((_,si)=>rosters(f,si).forEach(b=>(extras[b.id]||[]).forEach(id=>b.columns.forEach(c=>a.add(si+':'+extraRef(b,id,c))))));return a}
function storageKey(){return 'training-form-v1:'+current.id+':'+$('year').value}
function checkYear(y){if(!Number.isInteger(Number(y))||Number(y)<2020||Number(y)>2100)throw Error('평가 연도'+'를 확인하세요.')}
function validate(data,allowNumericErrors=false){if(data.version!==1)throw Error('지원하지 않는 작성 파일입니다.');const f=forms.find(f=>f.id===data.formId);if(!f)throw Error('양식을 찾을 수 없습니다.');if(f.conferenceHub)throw Error('집담회는 수련과를 선택한 개별 파일로 제출하세요.');checkYear(data.year);if(!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers))throw Error('입력값 형식이 다릅니다.');for(const ref of f.retiredRefs||[])delete data.answers[ref];
 const extras=data.extraRows||{};
 for(const band of f.retiredRosterIds||[]){const [si,header]=band.split(':');delete extras[band];for(const ref of Object.keys(data.answers))if(ref.startsWith(si+':repeat-'+header+'-'))delete data.answers[ref];}
 data.extraRows=extras;if(!extras||typeof extras!=='object'||Array.isArray(extras))throw Error('추가 행 형식이 다릅니다.');
 const bands=new Map(f.sheets.flatMap((_,si)=>rosters(f,si)).map(b=>[b.id,b]));
 for(const [k,ids] of Object.entries(extras)){if(!bands.has(k)||!Array.isArray(ids)||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^r[a-z0-9]{1,31}$/.test(id)))throw Error('추가 명단 행 정보를 확인하세요.');}
 if(f.category==='진료과'){for(const k of Object.keys(data.answers)){const m=k.match(/^\d+:[A-Z]+(\d+)$/);if(m&&Number(m[1])>=3&&Number(m[1])<=18)delete data.answers[k];}}
 const a=allowed(f,extras);for(const [k,v] of Object.entries(data.answers))if(!a.has(k)||typeof v!=='string'||v.length>4000)throw Error('지원하지 않는 항목이 포함되어 있습니다.');const calculationErrors=recalculate(f,data.answers);if(calculationErrors.length&&!allowNumericErrors)throw Error(calculationErrors[0].message);if(typeof data.note!=='string'||data.note.length>2000)throw Error('전달 내용 형식을 확인하세요.');return f}
function payload(){recalculate(current,answers);checkYear($('year').value);return {version:1,formId:current.id,department:current.title,category:current.category,year:Number($('year').value),answers:{...answers},extraRows:structuredClone(extraRows),note:$('note').value,createdAt:new Date().toISOString(),confirmed:$('confirmed').checked}}
function stash(){const data=payload();localStorage.setItem(storageKey(),JSON.stringify(data));dirty=false;message('이 브라우저에 임시 저장했습니다. 다른 컴퓨터에서는 제출 파일을 불러오세요.')}
function edit(){dirty=true;$('confirmed').checked=false}
function choicesFor(c){
 const parts=c.label.split(/\[\s*\]/).slice(1).map(s=>s.trim()).filter(Boolean);
 if(!parts.length){const row=current.sheets[sheetIndex].rows.find(row=>row.some(v=>v.ref===c.ref));const index=row?.findIndex(v=>v.ref===c.ref);const next=row?.slice(index+1).find(v=>v.label&&!v.check);parts.push(next?.label.trim()||'선택');}
 const compact=parts.map(s=>s.replace(/\s/g,''));
 const single=compact.includes('있음')&&compact.includes('없음')||compact.includes('분리함')&&compact.includes('분리하지않음')||compact.includes('구분함')&&compact.includes('구분하지않음')||compact.includes('2교대')&&compact.includes('3교대')||compact.includes('병원직영')&&compact.includes('위탁운영')||compact.includes('D.D.C.')||compact.includes('KORMARC');
 return {single,options:parts.map(raw=>{const placeholder=raw.match(/\(\s*(?:(과명|전체 장치 수)\s*:\s*)?(개|대|명|병상|㎡)?\s*\)/);return {raw,label:placeholder?raw.replace(placeholder[0],'').trim():raw,detail:!!placeholder,unit:placeholder?.[2]||'',hint:placeholder?.[1]||'상세'}})};
}
function choiceGroup(c){
 if(c.choiceGroup)return c.choiceGroup;
 const s=current.sheets[sheetIndex],cell=ref=>s.rows.flat().find(v=>v.ref===ref)?.label;
 const r=Number(c.ref.match(/\d+/)?.[0]);
 if(cell('B14')==='병원구분'&&r===14)return 'hospital-kind';
 if(cell('B15')==='병원설립'&&r>=15&&r<=20)return 'hospital-owner';
 if(cell('B21')?.includes('전공의')&&r>=21&&r<=23)return 'hospital-training';
 if(cell('B24')?.includes('응급진료')&&r>=24&&r<=26)return 'hospital-emergency';
 return null;
}
function parseChoice(value,options){const lines=(value||'').split('\n'),selected=new Map();for(const o of options){const line=lines.find(v=>v===o.raw||v===o.label||v.startsWith(o.label+' | '));if(line!==undefined)selected.set(o.raw,line.startsWith(o.label+' | ')?line.slice((o.label+' | ').length):'')}return selected}
function choiceNode(c,td){
 const spec=choicesFor(c);if(!spec)return false;const ref=c.ref,k=key(ref),group=choiceGroup(c),single=spec.single||!!group,selected=parseChoice(answers[k],spec.options),box=document.createElement('div');box.className='choices';box.setAttribute('role',single?'radiogroup':'group');box.setAttribute('aria-label',c.choicePrompt||current.sheets[sheetIndex].name+' '+c.ref+' 선택');box.dataset.ref=c.ref;if(group)box.dataset.choiceGroup=group;
 const controls=[];
 const update=()=>{const lines=controls.filter(v=>v.control.checked).map(v=>v.option.label+(v.option.detail&&v.detail.value?' | '+v.detail.value:''));
  if(group){for(const other of current.sheets[sheetIndex].rows.flat().filter(v=>v.check&&choiceGroup(v)===group))if(other.ref!==ref)delete answers[key(other.ref)];}
  if(lines.length)answers[k]=lines.join('\n');else delete answers[k];edit();
 };
 for(const [i,o] of spec.options.entries()){
  const row=document.createElement('div'),label=document.createElement('label'),control=document.createElement('input');control.type=single?'radio':'checkbox';control.name=group?'choice-'+sheetIndex+'-'+group:'choice-'+k;control.value=o.label;control.checked=selected.has(o.raw);label.append(control,document.createTextNode(' '+o.label));row.append(label);
  let detail=null;if(o.detail){detail=document.createElement('input');detail.type='text';detail.maxLength=200;detail.value=selected.get(o.raw)||'';detail.placeholder=o.unit?'수량 ('+o.unit+')':o.hint+' 입력';detail.setAttribute('aria-label',o.label+' '+o.hint);detail.disabled=!control.checked;detail.oninput=update;row.append(detail);if(o.unit)row.append(node('span',' '+o.unit));}
  controls.push({control,option:o,detail});control.onchange=()=>{if(single){for(const v of controls)if(v.detail)v.detail.disabled=!v.control.checked;}else if(detail)detail.disabled=!control.checked;update();if(group)refreshChoiceDetails(group)};box.append(row);
 }

 if(answers[k]&&selected.size===0)box.append(node('small','이전 입력: '+answers[k]+' (선택 항목을 다시 확인해 주세요)'));
 td.append(box);return true;
}
function numericValue(value,rule){
 const raw=(value||'').trim();if(!raw)return {empty:true,value:0};
 const pattern=rule==='integer'?/^(?:\d+|\d{1,3}(?:,\d{3})+)$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
 const n=Number(raw.replaceAll(',',''));return pattern.test(raw)&&Number.isFinite(n)&&n<=Number.MAX_SAFE_INTEGER?{empty:false,value:n}:{invalid:true};
}
function recalculate(f,values){
 const errors=[];
 f.sheets.forEach((s,si)=>{
  const cells=s.rows.flat(),byRef=new Map(cells.map(c=>[c.ref,c]));
  for(const c of cells.filter(c=>c.numericRule&&!c.calc))if(numericValue(values[si+':'+c.ref],c.numericRule).invalid)errors.push({key:si+':'+c.ref,message:(c.prompt||c.ref)+': '+(c.numericRule==='integer'?'0 이상의 정수':'0 이상의 숫자')+'를 입력하세요.'});
  for(const c of cells.filter(c=>c.calc)){
   const parts=c.calc.sum.map(ref=>numericValue(values[si+':'+ref],byRef.get(ref)?.numericRule||'decimal'));
   const k=si+':'+c.ref;
   if(parts.some(v=>v.invalid)||parts.every(v=>v.empty)){delete values[k];continue;}
   values[k]=String(Math.round(parts.reduce((sum,v)=>sum+v.value,0)*1e6)/1e6);
  }
 });return errors;
}
function refreshCalculations(){
 const errors=recalculate(current,answers);const bad=new Set(errors.map(e=>e.key));
 for(const c of current.sheets[sheetIndex].rows.flat())if(c.input){const input=$('grid').querySelector('textarea[data-ref="'+c.ref+'"]');if(input){if(c.calc)input.value=answers[key(c.ref)]||'';input.setAttribute('aria-invalid',String(bad.has(key(c.ref))))}}
 $('calculationStatus').textContent=errors.map(e=>e.message).join('\n');$('calculationStatus').hidden=!errors.length;
}
function refreshChoiceDetails(group){
 for(const box of $('grid').querySelectorAll('.choices'))if(box.dataset.choiceGroup===group)for(const row of box.children){const radio=row.querySelector('input[type=radio]'),detail=row.querySelector('input[type=text]');if(radio&&detail)detail.disabled=!radio.checked;}
}
function cellNode(c,ref=c.ref,label=''){
 const td=document.createElement('td');td.rowSpan=c.span[0];td.colSpan=c.span[1];if(c.highlight)td.classList.add('highlight');if(c.check&&choiceNode(c,td))return td;
 if(c.label){td.classList.add('label');td.append(node('span',c.label))}if(c.help){const help=node('small',c.help);help.className='field-help';td.append(help)}if(c.highlight)td.classList.add('highlight');
 if(c.input||c.check){const input=document.createElement('textarea');input.value=answers[key(ref)]||'';input.maxLength=4000;input.setAttribute('aria-label',label||c.prompt||current.sheets[sheetIndex].name+' '+ref+(c.label?' '+c.label:''));input.dataset.ref=ref;if(c.kind==='number'){input.inputMode=c.numericRule==='integer'?'numeric':'decimal';input.placeholder='숫자 입력';}if(c.calc){input.readOnly=true;input.setAttribute('aria-readonly','true');input.placeholder='자동 계산';input.className='calculated';}else if(c.prompt){input.placeholder=c.prompt+' 입력';}if(c.check)input.placeholder='해당 항목을 적어주세요';if(c.suppressPlaceholder)input.removeAttribute('placeholder');input.oninput=()=>{const k=key(ref);if(input.value)answers[k]=input.value;else delete answers[k];edit();refreshCalculations()};td.append(input)}return td;
}
function renderSheet(){
 recalculate(current,answers);const s=current.sheets[sheetIndex],bands=rosters(current,sheetIndex);$('sheetTitle').textContent=s.name;$('grid').replaceChildren();if(!s.rows.length){$('grid').append(node('caption',s.scopeNote||'이 부서의 작성 대상이 없습니다.'));return;}
 s.rows.forEach((row,index)=>{const tr=document.createElement('tr');row.forEach(c=>tr.append(cellNode(c)));
 if(bands.length){const heading=bands.find(b=>b.start===index),body=bands.find(b=>index>b.start&&index<=b.end);const management=document.createElement(heading?'th':'td');management.className=heading||body?'row-management':'row-management-spacer';if(heading){management.scope='col';management.textContent='행 관리';}else if(!body){management.setAttribute('aria-hidden','true');}tr.append(management);}
 $('grid').append(tr);
 for(const b of bands.filter(b=>b.end===index)){
 (extraRows[b.id]||[]).forEach((id,n)=>{const tr=document.createElement('tr');tr.className='extra-row';
 b.template.forEach((c,i)=>tr.append(cellNode(c,extraRef(b,id,b.columns[i]),b.title+' 추가 '+(n+1)+' '+(b.labels[i]||b.columns[i]))));
 const management=document.createElement('td');management.className='row-management';const remove=node('button','삭제');remove.type='button';remove.className='remove-row';remove.setAttribute('aria-label',b.title+' 추가 '+(n+1)+' 삭제');remove.onclick=()=>{const refs=b.columns.map(col=>key(extraRef(b,id,col)));if(refs.some(ref=>answers[ref])&&!confirm('이 추가 행의 입력 내용을 삭제할까요?'))return;extraRows[b.id]=extraRows[b.id].filter(v=>v!==id);refs.forEach(ref=>delete answers[ref]);edit();renderSheet()};management.append(remove);tr.append(management);$('grid').append(tr)});
 const action=document.createElement('tr'),td=document.createElement('td');td.colSpan=b.width+1;td.className='roster-actions';const add=node('button','+ 명단 행 추가');add.setAttribute('aria-label',b.title+' 행 추가');add.onclick=()=>{const ids=extraRows[b.id]||[];if(ids.length>=500){message('한 명단당 추가 행은 500개까지 지원합니다.');return}extraRows[b.id]=[...ids,'r'+crypto.randomUUID().replaceAll('-','').slice(0,24)];edit();renderSheet();const added=$('grid').querySelector('[data-ref="'+extraRef(b,extraRows[b.id].at(-1),b.columns[0])+'"]');added?.focus()};td.append(node('span',b.title+' · '),add);action.append(td);$('grid').append(action);
 }
 });refreshCalculations();[...$('tabs').children].forEach((b,i)=>b.classList.toggle('active',i===sheetIndex));
}
function show(which){$('list').hidden=which!=='list';$('form').hidden=which!=='form';$('admin').hidden=which!=='admin';$('conference').hidden=which!=='conference'}
function openForm(id,year=new Date().getFullYear(),load=true){current=forms.find(f=>f.id===id);if(!current)return;if(current.parentId&&current.conferenceActive===false){openConferenceHub(current.parentId);message(current.title+' 집담회는 작성 대상에서 제외되었습니다.');return;}if(current.conferenceHub){openConferenceHub(current.id);return;}if(current.excluded){show('list');message(current.title+'은 원본에 파란색 작성 범위가 없어 우선 입력에서 제외했습니다.');return;}answers={};extraRows={};notes='';sheetIndex=0;$('year').value=year;$('note').value='';$('confirmed').checked=false;$('title').textContent=current.title+' · '+current.category;$('conferenceBack').hidden=!current.parentId;$('formGuide').textContent=current.parentId?'선택한 수련과의 집담회 현황을 작성하세요. 작성값과 제출 파일은 과별로 따로 저장됩니다. 평균 시간은 단위를 함께 적고, 평균 출석률은 %로 적어주세요.':'빈칸은 해당 없음으로 두세요. 명단은 표 아래 ‘명단 행 추가’로 인원을 늘릴 수 있습니다. 부서별 지정 항목과 별도로 요청한 작성 항목을 입력하며, 표 제목과 항목명은 이해를 돕기 위해 함께 표시됩니다.';$('tabs').replaceChildren();current.sheets.forEach((s,i)=>{const b=node('button',s.name);b.onclick=()=>{sheetIndex=i;renderSheet()};$('tabs').append(b)});show('form');if(load){try{const saved=localStorage.getItem(storageKey());if(saved){const d=JSON.parse(saved);validate(d,true);answers=d.answers;extraRows=d.extraRows||{};$('note').value=d.note;message('이 브라우저에 저장된 내용을 불러왔습니다.')}else message('')}catch{message('임시 저장 자료를 읽을 수 없습니다. 제출 파일을 불러오거나 다시 작성하세요.')}}dirty=false;renderSheet();const u=new URL(location.href);u.searchParams.set('form',id);u.searchParams.set('year',year);history.replaceState(null,'',u)}
function cards(){const q=$('search').value.trim();$('cards').replaceChildren();const shown=forms.filter(f=>!f.parentId&&(f.title+f.category).includes(q));$('count').textContent=shown.length+'개 양식';for(const f of shown){const card=node('article','');card.className='card';card.append(node('small',f.category),node('h3',f.title),node('p',f.excluded?'작성 범위 지정 전 · 입력 제외':f.conferenceHub?'수련과별로 선택해서 작성':f.sheets.length+'개 시트 · 지정된 작성 항목'));const b=node('button',f.excluded?'입력 제외':f.conferenceHub?'수련과 선택':'작성하기');b.disabled=!!f.excluded;b.onclick=()=>openForm(f.id);card.append(b);$('cards').append(card)}}
function openConferenceHub(id){
 const hub=forms.find(f=>f.id===id&&f.conferenceHub);if(!hub)return;
 show('conference');dirty=false;message('');$('conferenceCards').replaceChildren();
 for(const f of forms.filter(f=>f.parentId===id&&f.conferenceActive!==false)){const card=node('article','');card.className='card';card.append(node('small','수련과별 집담회'),node('h3',f.title));const button=node('button','작성하기');button.setAttribute('aria-label',f.title+' 작성하기');button.onclick=()=>openForm(f.id,Number($('year').value)||new Date().getFullYear());card.append(button);$('conferenceCards').append(card)}
 const u=new URL(location.href);u.searchParams.set('form',id);u.searchParams.delete('year');history.replaceState(null,'',u);
}
$('conferenceBack').onclick=()=>{if(leave())openConferenceHub(current.parentId)};
function leave(){return !dirty||confirm('아직 저장하지 않은 내용이 있습니다. 다른 화면으로 이동할까요?')}
$('home').onclick=()=>{if(!leave())return;show('list');history.replaceState(null,'',location.pathname);message('')};$('collect').onclick=()=>{if(leave()){show('admin');message('')}};$('search').oninput=cards;
$('save').onclick=()=>{try{stash()}catch(e){message('저장하지 못했습니다: '+e.message)}};
$('year').onchange=()=>{if(!leave()){const y=new URL(location.href).searchParams.get('year');$('year').value=y;return}try{checkYear($('year').value);openForm(current.id,Number($('year').value))}catch(e){message(e.message)}};
$('note').oninput=edit;
function download(name,data,type){const u=URL.createObjectURL(new Blob([data],{type}));const a=node('a','');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('download').onclick=()=>{try{if(!$('confirmed').checked)throw Error('작성 내용 확인에 체크하세요.');const data=payload();validate(data);download(data.year+'_'+current.title+(current.parentId?'_집담회':'')+'_제출.json',JSON.stringify(data,null,2),'application/json');dirty=false;message('제출 파일을 저장했습니다. 내려받은 JSON 파일을 담당자에게 전달하세요. 서버로 자동 제출되지는 않습니다.')}catch(e){message(e.message)}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);message('이 양식 링크를 복사했습니다.')}catch{message('주소창의 주소를 복사해 담당 부서에 보내세요.')}};
$('restore').onchange=async()=>{try{const f=$('restore').files[0];if(!f)return;if(f.size>2000000)throw Error('파일이 너무 큽니다.');const d=JSON.parse(await f.text());const form=validate(d);if(form.parentId&&form.conferenceActive===false)throw Error('집담회 작성 대상에서 제외된 과입니다. 이전 제출 파일은 담당자 취합 화면에서 확인할 수 있습니다.');if(!leave())return;openForm(form.id,d.year,false);answers=d.answers;extraRows=d.extraRows||{};$('note').value=d.note;renderSheet();dirty=true;message('작성 파일을 불러왔습니다.')}catch(e){message('불러오기 실패: '+e.message)}finally{$('restore').value=''}};
function renderImports(){ $('importRows').replaceChildren();for(const d of imports.values()){const f=forms.find(f=>f.id===d.formId),tr=document.createElement('tr');for(const v of [f.parentId?f.title+' · 집담회':f.title,d.year,d.createdAt,Object.keys(d.answers).length])tr.append(node('td',String(v)));$('importRows').append(tr)}$('importSummary').textContent=imports.size+'개 부서·연도 자료를 읽었습니다. 같은 부서·연도 파일은 마지막으로 선택한 파일을 사용합니다.'}
$('imports').onchange=async()=>{const errors=[];for(const f of $('imports').files){try{if(f.size>2000000)throw Error('파일이 너무 큽니다.');const d=JSON.parse(await f.text());validate(d);if(d.confirmed!==true)throw Error('확인된 제출 파일이 아닙니다.');imports.set(d.formId+':'+d.year,d)}catch(e){errors.push(f.name+': '+e.message)}}renderImports();message(errors.join('\n'));$('imports').value=''};
function exportLabel(f,si,ref,extras){for(const b of rosters(f,si))for(const [n,id] of (extras[b.id]||[]).entries())for(const [i,col] of b.columns.entries())if(ref===extraRef(b,id,col))return b.title+' 추가'+' '+(n+1)+' '+(b.labels[i]||col);return ref}
$('csv').onclick=()=>{if(!imports.size){message('회신 파일을 먼저 선택하세요.');return}const rows=[['부서','분류','평가연도','시트','셀','입력값','전달사항']];for(const d of imports.values()){const f=forms.find(f=>f.id===d.formId);for(const [k,v] of Object.entries(d.answers)){const [i,ref]=k.split(':');rows.push([f.title,f.category,d.year,f.sheets[Number(i)].name,exportLabel(f,Number(i),ref,d.extraRows||{}),v,d.note])}if(!Object.keys(d.answers).length)rows.push([f.title,f.category,d.year,'','','',d.note])}const q=v=>'"'+String(v).replace(/"/g,'""').replace(/^([=+@-])/,'\t$1')+'"';download('실태조서_취합.csv','\ufeff'+rows.map(r=>r.map(q).join(',')).join('\r\n'),'text/csv;charset=utf-8')};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
(async()=>{try{const r=await fetch('forms.json?v=imaging-12',{cache:'no-store'});if(!r.ok)throw Error('양식을 불러오지 못했습니다.');forms=await r.json();cards();const p=new URL(location.href).searchParams;if(p.has('form'))openForm(p.get('form'),Number(p.get('year')||new Date().getFullYear()))}catch(e){message(e.message)}})();
