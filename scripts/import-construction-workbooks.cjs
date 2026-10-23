/* Explicit, transactional first import. No startup import and no overwrite of live edits.
   node scripts/import-construction-workbooks.cjs --directory /path/to/xlsx [--apply]
   Default: write a reviewable manifest only. */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const files = ['Perla İlerleme Takip.xlsx', 'ŞEREF 2026 MART HAKEDİŞ PERLA.xlsx', 'PERLA 2 Maliyet Tablosu.xlsx'];
const at = process.argv.indexOf('--directory');
if (at < 0 || !process.argv[at + 1]) throw new Error('--directory is required');
const directory = path.resolve(process.argv[at + 1]);
const books = files.map(name => {
  const bytes = fs.readFileSync(path.join(directory, name));
  return {name, hash:crypto.createHash('sha256').update(bytes).digest('hex'), book:XLSX.read(bytes, {cellFormula:true, cellDates:false})};
});
const val = (s, a) => s[a]?.v;
const num = (s, a) => { const v=val(s,a); if(v == null || v === '') return 0; if(typeof v!=='number'||!Number.isFinite(v)) throw new Error(`Invalid number ${a}`);return v; };
const txt = (s,a) => String(val(s,a)??'').trim();
const snapshot = book => book.SheetNames.map(name => ({name, cells:Object.entries(book.Sheets[name]).filter(([a,c])=>!a.startsWith('!') && c.v!=null).map(([address,c])=>({address,value:c.v,...(c.f?{formula:c.f}:{})}))}));
const sources = books.map((b,i)=>({id:['perla-progress-2026','perla-claim-13','perla2-budget-2026'][i],projectId:i===2?'perla-ii':'perla',kind:['PROGRESS','CLAIM','BUDGET'][i],fileName:b.name,sha256:b.hash,sourceDate:i===1?new Date('2026-03-30T00:00:00Z'):null,dateBasis:i===1?'Belgedeki hakediş tarihi':'Verinin geçerlilik tarihi belgede teyit edilmedi.',snapshot:snapshot(b.book)}));
const projects=[{id:'perla',crmProject:'LA_JOYA_PERLA',name:'La Joya Perla',notes:'İlerleme ve 13 numaralı Mart 2026 hakedişi. Maliyet bütçesi bu projeye ait değildir.'},{id:'perla-ii',crmProject:'LA_JOYA_PERLA_II',name:'La Joya Perla II',notes:'PERLA 2 bütçesi. İlerleme ve hakediş dosyaları henüz sağlanmadı.'}];
const trades=[], units=[], entries=[];
const blockNames=['A','B','C','D','E','F','G','H1','H2'];
const first=books[0].book.Sheets['A BLOK'];
for(let col=3;col<=33;col++) {const letter=XLSX.utils.encode_col(col);trades.push({id:`perla-trade-${col}`,projectId:'perla',name:txt(first,`${letter}9`),weight:num(first,`${letter}8`)*100,position:col});}
if(Math.abs(trades.reduce((n,t)=>n+t.weight,0)-100)>0.00001) throw new Error('Progress weights must total 100');
for(const block of blockNames){
 const s=books[0].book.Sheets[`${block} BLOK`]; if(!s)throw new Error(`Missing block ${block}`);
 const last=XLSX.utils.decode_range(s['!ref']).e.r+1;
 for(let row=10;row<=last;row++){
  if(!txt(s,`A${row}`) || !s[`B${row}`]?.f)continue;
  const id=`perla-unit-${block}-${row}`;const label=txt(s,`A${row}`);const rest=/REST/i.test(label);
  units.push({id,projectId:'perla',block,label,position:row,included:!rest,scopeNote:rest?'Kaynak özeti dışında: REST. alanı; kapsam onayı bekliyor.':label==='9-10-11'?'Kaynakta üç numara tek takip satırıdır.':'',sourceRef:`${block} BLOK!A${row}:AH${row}`});
  for(const t of trades){const col=XLSX.utils.encode_col(t.position);const sourceStatus=txt(s,`${col}${row}`);if(!['Bitti','Bitmedi','Eksik Var'].includes(sourceStatus))throw new Error(`Unexpected status ${block}/${row}/${col}`);if(Math.abs(num(s,`${col}8`)*100-t.weight)>0.00001)throw new Error('Different block weights');entries.push({id:`${id}-t${t.position}`,unitId:id,tradeId:t.id,status:sourceStatus==='Bitti'?'DONE':sourceStatus==='Eksik Var'?'PARTIAL':'NOT_DONE',quality:'UNCHECKED',sourceStatus});}
 }
}
if(units.length!==372 || entries.length!==11532) throw new Error('Unexpected progress shape');
const ks=books[1].book.Sheets['4-Keşif Özeti'];
const measurementNames=['ŞAP','TERAS SIVA','KARA SIVA DIŞ','DIŞ SÜS ALIN','DIŞ SÜS KRİŞ','BORDEX','MERMER KÜPEŞTE BALKON','BORDEX SIVA','İÇ CEPHE BOYA','MERMER KAPI EŞİK','MERMER BASAMAK','MERMER DÖŞEME','MERMER SÜPÜRGELİK','ALÇI SIVA','YEVMİYE'];
const claim={id:'perla-claim-13',projectId:'perla',contractor:txt(ks,'C6'),number:'13',period:new Date('2026-03-30T00:00:00Z'),currency:'GBP',taxRate:10,adjustment:num(ks,'O28'),adjustmentNote:'Kaynak hakediş min­hası; gerekçesi ve kümülatif işareti teyit bekliyor.',deduction:0,sourceNet:131507.27,sourceRef:'2-Hakediş İcmali!V39',note:'Kaynak aktarımıdır; sözleşme ve önceki dönem mutabakatı bekliyor. Ödeme kaydı değildir.'};
const claimLines=[];
for(let row=13;row<=27;row++){
 const mname=measurementNames[row-13];const measurement=sources[1].snapshot.find(s=>s.name===mname);if(!measurement)throw new Error(`Missing measurement ${mname}`);
 claimLines.push({id:`perla-claim13-line${row}`,claimId:claim.id,position:row,code:txt(ks,`B${row}`),name:txt(ks,`C${row}`),unit:txt(ks,`F${row}`),previousQty:num(ks,`K${row}`),measuredQty:row===15?2251.53:num(ks,`L${row}`),acceptedQty:num(ks,`L${row}`),unitPrice:num(ks,`H${row}`),sourceAmount:num(ks,`O${row}`),sourceRef:`4-Keşif Özeti!${row}`,note:row===15?'Kaynak açıklaması: %50 hakediş. Kabul miktarı kaynakta 1.125,76 m².':'',measurements:measurement});
}
const s=books[2].book.Sheets.MALİYET;
const budget={id:'perla2-budget-2026',projectId:'perla-ii',name:'PERLA 2 · Kaynak bütçe',currency:'GBP',sourceTotal:num(s,'C167'),sourceRef:'MALİYET!C167'};
const budgetItems=[];let category='';
for(let row=1;row<=151;row++){
 const name=txt(s,`A${row}`); if(/^\d+\s*[-–]/.test(name))category=name;
 if(!name||!s[`I${row}`]?.f)continue;
 budgetItems.push({id:`perla2-budget-row${row}`,budgetId:budget.id,category,position:row,name,unit:txt(s,`B${row}`),quantity:row===101?1:num(s,`C${row}`),unitPrice:num(s,`D${row}`),sourceAmount:num(s,`I${row}`),sourceRef:`MALİYET!${row}`,sourceFormula:s[`I${row}`].f,note:row===101?'Kaynak toplamı doğrudan D101 toplu bedelidir; hesapta miktar 1 kullanılır.':row===150?'Kaynak formül C148 × D150 kullanıyor. Sistem bu satırın kendi miktarıyla C150 × D150 hesaplar.':row===93?'Kaynak bölüm toplamı bu satırı dışarıda bırakıyor. Sistem bütün kalemleri toplar.':''});
}
if(budgetItems.length!==106)throw new Error(`Unexpected budget line count ${budgetItems.length}`);
const issue=(id,projectId,area,severity,title,detail,requiredInfo,sourceRef,owner)=>({id,projectId,area,severity,title,detail,requiredInfo,sourceRef,owner});
const issues=[
issue('perla-scope','perla','PROGRESS','HIGH','REST. alanları ve birleşik daire','D Blok 15–18 REST. genel yüzdeye dahil değil; 9-10-11 tek takip satırı.','REST. alanlarının kullanım türü ve özete dahil edilme kararı; birleşik birimin teyidi.','D BLOK!A18, A38:AH41','Şantiye / proje yönetimi'),
issue('perla-unit-match','perla','PROGRESS','HIGH','Şantiye birimleri ile CRM eşleştirmesi','Excel 368 özet birimi + 4 REST. alanı içeriyor. CRM müşteri-da­ire kayıtları farklı kapsamda; otomatik birleştirme yapılmadı.','Onaylı blok, kapı numarası, birleşen daire ve ortak alan listesi.','Blok Özeti / CRM All Units','Proje yönetimi / satış sonrası'),
issue('perla-date','perla','PROGRESS','HIGH','İlerleme verisinin kontrol tarihi','Excel dosyasının değiştirilme tarihi, sahadaki kontrol tarihi olarak kullanılmadı.','Bu durumların hangi tarih itibarıyla geçerli olduğu ve güncelleme sorumluları.','Perla İlerleme Takip.xlsx','Şantiye'),
issue('perla-quality','perla','QUALITY','MEDIUM','Kalite kontrolleri henüz girilmemiş','Kaynak kontrol sayfası tamamen Kontrol Edilmedi; puan toplamında ve son satırlarda formül eksikleri var. Sistem kaliteyi ilerlemeden ayrı hesaplıyor.','Daire bazında kontrol sonuçları, eksikler, kontrol tarihi ve sorumlusu.','İnce İşler Checklist!B6, B7, E40:E41','Kalite / şantiye'),
issue('perla-contract','perla','CLAIM','HIGH','Sözleşme ve önceki hakedişler','Sözleşme miktarları boş; %100 değerleri elle girilmiş. İcmal ve keşif kümülatif toplamlarının kapsamı farklı.','İmzalı sözleşme, poz listesi, birim fiyatlar ve 1–12 numaralı hakedişler.','4-Keşif Özeti!G13:J28 / 2-Hakediş İcmali','Teknik ofis / finans'),
issue('perla-minha','perla','CLAIM','HIGH','22.214,60 £ düşümün açıklaması','Dönemde eksi, kümülatifte artı yazılmış; kümülatif tutarda 44.429,20 £ işaret farkı oluşuyor.','Düşümün gerekçesi, belgesi ve doğru kümülatif işareti.','4-Keşif Özeti!O28:P28','Teknik ofis / finans'),
issue('perla-quantities','perla','CLAIM','HIGH','Metraj ve hakediş miktarı ayrımı','Dış sıvada 2.251,53 m² fiziksel / 1.125,76 m² kabul; yevmiyede Yeşil Defter miktar alanlarına para yazılmış.','Kabul oranı, yuvarlama kuralı ve birimlerin onayı; yevmiye 48 adet olarak aktarıldı.','KARA SIVA DIŞ / 5-Yeşil Defter!J27:L27','Teknik ofis'),
issue('perla-claim-source','perla','CLAIM','MEDIUM','Eski bağlantılar ve elle yazılan toplamlar','Kaynakta eski Excel bağlantıları ve elle yazılmış icmal sonuçları var; önceki dönem toplamı yevmiyeyi dışlıyor.','Önceki dönem mutabakatı, geçerli belge tarihi ve imzalı nihai hakediş.','2-Hakediş İcmali / 4-Keşif Özeti!N29','Teknik ofis'),
issue('perla-payments','perla','CLAIM','HIGH','Hakediş ödeme bilgisi yok','Hakediş neti ödeme yapıldığını kanıtlamaz. Sisteme gerçek ödeme girilmedi.','Ödeme tarihleri, banka/dekont, tutar ve hangi hakedişe ait olduğu.','2-Hakediş İcmali','Finans'),
issue('perla-budget-missing','perla','BUDGET','HIGH','Perla bütçesi eksik','Sağlanan bütçe PERLA 2 başlıklı ve Perla II projesinde tutuluyor.','Perla projesinin kendi güncel bütçesi.','PERLA 2 Maliyet Tablosu.xlsx','Proje yönetimi'),
issue('perla2-scope','perla-ii','BUDGET','HIGH','Bütçenin faz ve kapsam onayı','CRM Perla ve Perla II projelerini ayrı tutuyor; dosya başlığı PERLA 2. Bu bütçe Perla II olarak ayrıldı.','Bütçe sahibinden proje/faz, bloklar, kapsam ve revizyon tarihi onayı.','MALİYET!A1','Proje yönetimi'),
issue('perla2-formula','perla-ii','BUDGET','HIGH','Havuz tutamak hesabında 3.060 £ fark','Kaynak 130 × 30 = 3.900 £; satır miktarı 28 × 30 = 840 £. Kaynak tutarı korunur, hesaplanan bütçe ayrı gösterilir.','28 metre miktarın ve 840 £ satır tutarının teknik ofis teyidi.','MALİYET!C150:D150, I150','Teknik ofis'),
issue('perla2-assumptions','perla-ii','BUDGET','HIGH','Fiyat, kur, KDV ve sıfır miktarlar','Kur katsayıları sabit; KDV kapsamı belirtilmemiş; 7 satırın miktarı sıfır. Çatı lavabo bataryası kaynak toplam aralığı dışında.','Fiyat/kur tarihi, para birimleri, KDV dahil/haric durumu, fire oranları ve sıfır kalemlerin kapsamı.','MALİYET','Satın alma / finans'),
issue('perla2-actuals','perla-ii','BUDGET','HIGH','Gerçekleşen iş ve ödeme eksik','Yapılan iş/ödeme alanları boş; boş değerler sıfır ödeme gibi gösterilmez.','Ölçülen gerçekleşen miktarlar ve belgeli ödeme dökümü.','MALİYET!E:H','Şantiye / finans'),
issue('perla2-progress','perla-ii','PROGRESS','MEDIUM','Perla II ilerleme ve hakedişleri eksik','Sağlanan ilerleme ve Mart hakedişi Perla kaynağı; Perla II içine kopyalanmadı.','Perla II blok/daire listesi, iş ağırlıkları ve hakediş dosyaları.','Kaynak envanteri','Şantiye / teknik ofis'),
issue('construction-access','perla','GENERAL','MEDIUM','Ekip ve yetki listesi','İlk sürüm ADMIN düzenleme, ACCOUNTING salt okuma ile açılır. Satış rolleri maliyet ve taşeron verilerini göremez.','Şantiye, teknik ofis, proje yöneticisi ve finans için isim bazında erişim ve onay akışı.','Sistem yetkileri','Yönetim')
];
const data={projects,sources,trades,units,entries,claim,claimLines,budget,budgetItems,issues};
const out=path.resolve('../artifacts/perla-excel-review-20261022/construction-import.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(data));
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'review',sources:sources.map(({fileName,sha256})=>({fileName,sha256})),units:units.length,included:units.filter(x=>x.included).length,trades:trades.length,entries:entries.length,claimLines:claimLines.length,budgetItems:budgetItems.length,issues:issues.length,manifest:out},null,2));
if(process.argv.includes('--apply')){
 const {PrismaClient}=require('@prisma/client');const {PrismaPg}=require('@prisma/adapter-pg');const {Pool}=require('pg');
 const pool=new Pool({max:2,idleTimeoutMillis:1000,connectionTimeoutMillis:15000,connectionString:process.env.DATABASE_URL,ssl:{ca:fs.readFileSync('supabase-ca.crt','utf8'),rejectUnauthorized:true}});const db=new PrismaClient({adapter:new PrismaPg(pool)});pool.on('error',e=>console.error('Idle PostgreSQL connection closed:',e.code||e.message));
 (async()=>{await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301022)`;
  const existing=await tx.constructionSource.findMany({select:{sha256:true}});
  if(sources.every(s=>existing.some(e=>e.sha256===s.sha256))){console.log('Already imported; live records unchanged.');return;}
  if(await tx.constructionProject.count())throw new Error('Existing construction data: reviewed reconciliation is required; no overwrite.');
  await tx.constructionProject.createMany({data:projects});await tx.constructionSource.createMany({data:sources});await tx.constructionTrade.createMany({data:trades});await tx.constructionUnit.createMany({data:units});
  for(let i=0;i<entries.length;i+=500)await tx.constructionProgress.createMany({data:entries.slice(i,i+500)});
  await tx.constructionClaim.create({data:claim});await tx.constructionClaimLine.createMany({data:claimLines});await tx.constructionBudget.create({data:budget});await tx.constructionBudgetItem.createMany({data:budgetItems});await tx.constructionIssue.createMany({data:issues});
  console.log('Construction import committed.');
 },{timeout:120000,maxWait:10000});})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{await db.$disconnect();await pool.end();});
}
