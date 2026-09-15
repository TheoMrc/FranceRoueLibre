const SOURCE_URL = 'https://www.data.gouv.fr/datasets/projets-finances-par-les-dotations-de-soutien-a-linvestissement-des-collectivites-territoriales';
const REGION_NAMES = {'01':'Guadeloupe','02':'Martinique','03':'Guyane','04':'La Réunion','06':'Mayotte','11':'Île-de-France','24':'Centre-Val de Loire','27':'Bourgogne-Franche-Comté','28':'Normandie','32':'Hauts-de-France','44':'Grand Est','52':'Pays de la Loire','53':'Bretagne','75':'Nouvelle-Aquitaine','76':'Occitanie','84':'Auvergne-Rhône-Alpes','93':'Provence-Alpes-Côte d’Azur','94':'Corse'};
const SCHEME_NAMES = {DETR:'Équipement des territoires ruraux',DSIL:'Soutien à l’investissement local',DPV:'Politique de la ville',DSID:'Soutien à l’investissement des départements'};
const overseasCodes = new Set(['971','972','973','974','976']);
const amountFormat = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0});
const numberFormat = new Intl.NumberFormat('fr-FR');
const shortFormat = new Intl.NumberFormat('fr-FR',{notation:'compact',maximumFractionDigits:1});
const $ = id => document.getElementById(id);
const state = {records:[],features:[],departments:new Map(),region:'',scheme:'',search:'',department:'',visible:12};

function normalize(value){return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr-FR')}
function euro(value){return amountFormat.format(value)}
function compactEuro(value){return `${shortFormat.format(value)} €`}
function featureCode(feature){return feature.properties.code}
function field(node,text){node.textContent=text;return node}

function matches(record,ignoreDepartment=false){
  const meta=state.departments.get(record.department);
  if(state.region && meta?.region!==state.region)return false;
  if(state.scheme && record.scheme!==state.scheme)return false;
  if(!ignoreDepartment && state.department && record.department!==state.department)return false;
  if(state.search && !normalize(`${record.title} ${record.beneficiary} ${record.commune} ${record.siren} ${meta?.name}`).includes(normalize(state.search)))return false;
  return true;
}
function totals(records){return records.reduce((sum,item)=>sum+item.amount,0)}
function grouped(records){const map=new Map();for(const item of records)map.set(item.department,(map.get(item.department)||0)+item.amount);return map}

function pathFor(geometry){
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.flatMap(polygon=>polygon.map(ring=>ring.map(([lon,lat],i)=>`${i?'L':'M'}${((lon+5.6)*42+28).toFixed(1)},${((51.35-lat)*53+21).toFixed(1)}`).join('')+'Z')).join('');
}
function drawMap(filtered,group){
  const svg=$('map');svg.querySelectorAll('.department').forEach(path=>path.remove());
  const max=Math.max(...group.values(),1);
  for(const feature of state.features){
    const code=featureCode(feature);if(overseasCodes.has(code)||!REGION_NAMES[feature.properties.region])continue;
    const value=group.get(code)||0;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',pathFor(feature.geometry));path.setAttribute('class',`department${state.department===code?' selected':''}`);
    path.setAttribute('data-code',code);path.setAttribute('tabindex','0');path.setAttribute('role','button');
    const name=feature.properties.nom;
    path.setAttribute('aria-label',`${name} : ${value?euro(value):'aucun projet dans la sélection'}`);
    const strength=Math.sqrt(value/max);
    path.style.fill=value?`color-mix(in srgb, var(--accent-cyan) ${Math.round(21+strength*58)}%, var(--map-land))`:'var(--map-land)';
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${name} · ${value?euro(value):'aucun projet dans la sélection'}`;path.append(title);
    path.addEventListener('click',()=>selectDepartment(code));
    path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectDepartment(code)}});
    svg.append(path);
  }
  const overseas=$('overseas');overseas.replaceChildren();
  for(const code of overseasCodes){const meta=state.departments.get(code);if(!meta)continue;const btn=document.createElement('button');btn.type='button';btn.className=`overseas-btn${state.department===code?' selected':''}`;const name=document.createElement('span');field(name,meta.name);btn.append(name,document.createTextNode(group.get(code)?compactEuro(group.get(code)):'Aucun projet'));btn.addEventListener('click',()=>selectDepartment(code));overseas.append(btn)}
  const unmapped=$('unmapped');unmapped.replaceChildren();
  for(const code of ['67A','691'])if(group.get(code)){if(!unmapped.children.length){const label=document.createElement('p');label.className='small-label';field(label,'TERRITOIRES SPÉCIFIQUES');unmapped.append(label)}const btn=document.createElement('button');btn.type='button';btn.className=`overseas-btn${state.department===code?' selected':''}`;field(btn,`${state.departments.get(code).name} · ${compactEuro(group.get(code))}`);btn.addEventListener('click',()=>selectDepartment(code));unmapped.append(btn)}
}
function selectDepartment(code){state.department=state.department===code?'':code;state.visible=12;render();$('detailTitle').scrollIntoView({behavior:'smooth',block:'nearest'})}
function projectNode(record){
  const article=document.createElement('article');article.className='project-row';
  const top=document.createElement('div');top.className='project-top';
  const title=document.createElement('h3');field(title,record.title||'Projet sans intitulé');
  const amount=document.createElement('span');amount.className='project-amount';field(amount,euro(record.amount));top.append(title,amount);
  const beneficiary=document.createElement('div');beneficiary.className='project-beneficiary';
  const departmentName=state.departments.get(record.department)?.name||record.department;
  const beneficiaryName=/^\d+$/.test(record.beneficiary)&&record.beneficiaryType==='departement'
    ? record.department==='67A'?'Collectivité d’Alsace':`Département de ${departmentName}`
    : record.beneficiary;
  field(beneficiary,beneficiaryName);
  const meta=document.createElement('div');meta.className='project-meta';
  const badge=document.createElement('span');badge.className='scheme-badge';badge.title=SCHEME_NAMES[record.scheme]||record.scheme;field(badge,record.scheme);
  const dep=document.createElement('span');field(dep,state.departments.get(record.department)?.name||record.department);
  const type=document.createElement('span');field(type,record.beneficiaryType==='epci'?'Intercommunalité':record.beneficiaryType==='commune'?'Commune':record.beneficiaryType==='departement'?'Département':record.beneficiaryType||'Collectivité');
  const cost=document.createElement('span');field(cost,`Coût du projet : ${euro(record.cost)}`);
  meta.append(badge,dep,type,cost);
  article.append(top,beneficiary,meta);return article;
}
function render(){
  const geographic=state.records.filter(record=>matches(record,true));
  const records=geographic.filter(record=>matches(record));
  const group=grouped(geographic);
  $('totalAmount').textContent=compactEuro(totals(records));
  $('totalAmount').title=euro(totals(records));
  $('projectCount').textContent=numberFormat.format(records.length);
  $('departmentCount').textContent=numberFormat.format(new Set(records.filter(record=>!['67A','691'].includes(record.department)).map(record=>record.department)).size);
  $('detailTitle').textContent=state.department?state.departments.get(state.department)?.name||state.department:'Tous les territoires';
  $('clearDepartment').hidden=!state.department;
  $('detailSummary').textContent=records.length?`${numberFormat.format(records.length)} projets · ${euro(totals(records))} de subventions accordées`:'Aucun projet ne correspond aux filtres sélectionnés.';
  drawMap(geographic,group);
  const list=$('projectList');list.replaceChildren();
  if(!records.length){const empty=document.createElement('div');empty.className='empty-state';field(empty,'Essayez un autre territoire, dispositif ou mot-clé.');list.append(empty)}
  else{const sorted=[...records].sort((a,b)=>b.amount-a.amount||a.id-b.id);for(const record of sorted.slice(0,state.visible))list.append(projectNode(record))}
  $('listCount').textContent=records.length?`${numberFormat.format(Math.min(state.visible,records.length))} sur ${numberFormat.format(records.length)} projets`:'';
  $('more').hidden=records.length<=state.visible;
}
function populate(){
  const regions=[...new Set(state.features.map(feature=>feature.properties.region))].filter(code=>REGION_NAMES[code]).sort((a,b)=>REGION_NAMES[a].localeCompare(REGION_NAMES[b],'fr'));
  for(const code of regions){const option=document.createElement('option');option.value=code;field(option,REGION_NAMES[code]||code);$('region').append(option)}
  for(const scheme of [...new Set(state.records.map(record=>record.scheme))].sort()){const option=document.createElement('option');option.value=scheme;field(option,`${scheme} · ${SCHEME_NAMES[scheme]||scheme}`);$('scheme').append(option)}
}
function bind(){
  $('search').addEventListener('input',event=>{state.search=event.target.value;state.visible=12;render()});
  $('region').addEventListener('change',event=>{state.region=event.target.value;state.department='';state.visible=12;render()});
  $('scheme').addEventListener('change',event=>{state.scheme=event.target.value;state.visible=12;render()});
  $('reset').addEventListener('click',()=>{state.region='';state.scheme='';state.search='';state.department='';state.visible=12;$('region').value='';$('scheme').value='';$('search').value='';render()});
  $('clearDepartment').addEventListener('click',()=>{state.department='';render()});
  $('more').addEventListener('click',()=>{state.visible+=12;render()});
  const saved=localStorage.getItem('frl-theme');if(saved==='light'||saved==='dark')document.documentElement.dataset.theme=saved;
  updateThemeLabel();$('themeToggle').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('frl-theme',next);updateThemeLabel()});
}
function updateThemeLabel(){$('themeToggle').setAttribute('aria-label',document.documentElement.dataset.theme==='dark'?'Passer au thème clair':'Passer au thème sombre')}
async function start(){
  bind();
  try{
    const responses=await Promise.all([fetch('./data/projects-2025.json'),fetch('./data/departments.geojson')]);
    if(responses.some(response=>!response.ok))throw new Error('Téléchargement des données impossible');
    [state.records,{features:state.features}]=await Promise.all(responses.map(response=>response.json()));
    state.departments=new Map(state.features.map(feature=>[featureCode(feature),{name:feature.properties.nom,region:feature.properties.region}]));
    state.departments.set('67A',{name:'Alsace (non réparti)',region:'44'});
    state.departments.set('691',{name:'Métropole de Lyon',region:'84'});
    populate();render();
  }catch(error){$('detailSummary').textContent='Les données ne peuvent pas être chargées. Réessayez plus tard.';$('projectList').textContent=error.message;console.error(error)}
}
start();
