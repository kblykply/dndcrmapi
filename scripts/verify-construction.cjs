// Read-only verification plus writes inside one deliberately rolled-back transaction.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict'),fs=require('node:fs');
const{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg'),{Pool}=require('pg');
const{ConstructionService}=require('../dist/src/construction/construction.service');
const{JwtService}=require('@nestjs/jwt');
const pool=new Pool({max:2,idleTimeoutMillis:1000,connectionTimeoutMillis:15000,connectionString:process.env.DATABASE_URL,ssl:{ca:fs.readFileSync('supabase-ca.crt','utf8'),rejectUnauthorized:true}}),db=new PrismaClient({adapter:new PrismaPg(pool)});
pool.on('error',e=>console.error('Idle PostgreSQL connection closed:',e.code||e.message));
(async()=>{
 const admin=await db.user.findFirst({where:{role:'ADMIN',isActive:true},select:{id:true,name:true,role:true}});assert(admin);
 const svc=new ConstructionService(db);const workspace=await svc.workspace(admin);const p=await svc.project('perla',admin),p2=await svc.project('perla-ii',admin);const budget=await svc.budget('perla2-budget-2026',admin),claim=await svc.claim('perla-claim-13',admin),unit=await svc.unit('perla-unit-A-10',admin);
 assert.equal(p.units.length,372);assert.equal(p.units.filter(u=>u.included).length,368);assert.equal(p2.units.length,0);assert.equal(p.budgets.length,0);assert.equal(p2.claims.length,0);assert.equal(workspace.projects.find(p=>p.id==='perla').progress,56.375);assert.equal(unit.progress,63);assert.equal(unit.entries.length,31);assert.equal(budget.items.length,106);assert.equal(budget.totals.calculated,6756003.87);assert.equal(claim.totals.net,131507.27);assert.equal(budget.totals.paid,null);
 assert.equal(budget.items.find(i=>i.position===150).calculated,840);assert.equal(p.units.filter(u=>!u.included).length,4);
 const beforeAudit=await db.constructionActivity.count();const beforeEntry=unit.entries[0];const beforeItem=budget.items.find(i=>i.position===150);const beforeIssue=p.issues[0];let rolled=false;
 try{await db.$transaction(async tx=>{
  const transactionFacade=new Proxy(tx,{get:(target,key)=>key==='$transaction'?async cb=>cb(tx):target[key]});const service=new ConstructionService(transactionFacade);
  const entryData={version:beforeEntry.version,status:'NOT_DONE',quality:'PARTIAL',note:'ROLLBACK TEST',reason:'Construction integration rollback test'};
  await service.updateEntry(unit.id,beforeEntry.id,entryData,admin);
  assert.equal((await tx.constructionProgress.findUnique({where:{id:beforeEntry.id}})).version,beforeEntry.version+1);
  await assert.rejects(service.updateEntry(unit.id,beforeEntry.id,entryData,admin),e=>e.status===409);
  await service.updateBudgetItem(budget.id,beforeItem.id,{version:beforeItem.version,quantity:'29',unitPrice:'30',completedQty:'0',paid:'0',note:'ROLLBACK TEST',reason:'Construction integration rollback test'},admin);
  assert.equal((await service.budget(budget.id,admin)).items.find(i=>i.id===beforeItem.id).calculated,870);
  const l=claim.lines[0];await service.updateClaimLine(claim.id,l.id,{version:claim.version,previousQty:String(l.previousQty),measuredQty:String(l.measuredQty),acceptedQty:'412.42',unitPrice:String(l.unitPrice),note:'ROLLBACK TEST',reason:'Construction integration rollback test'},admin);
  const updated=await service.claim(claim.id,admin);assert.equal(updated.totals.net,131520.47);
  const next=await service.createClaim(claim.id,{version:updated.version,number:'ROLLBACK-TEST',period:'2026-04-30',reason:'Construction integration rollback test'},admin);
  const newClaim=await service.claim(next.id,admin);assert.equal(newClaim.totals.net,0);assert.equal(newClaim.lines.length,15);assert.equal(Number(newClaim.lines[0].previousQty),1177.30);assert.equal(newClaim.sourceNet,null);
  assert.equal((await service.claim(claim.id,admin)).canEdit,false);
  await assert.rejects(service.updateClaimLine(claim.id,l.id,{version:updated.version+1,previousQty:String(l.previousQty),measuredQty:null,acceptedQty:0,unitPrice:String(l.unitPrice),note:"ROLLBACK",reason:"Prior period must be locked"},admin),e=>e.status===409);
  await service.updateIssue(beforeIssue.id,{version:beforeIssue.version,status:'RESOLVED',resolution:'ROLLBACK TEST ONLY — no actual resolution',reason:'Construction integration rollback test'},admin);
  assert.equal(await tx.constructionActivity.count(),beforeAudit+5);
  throw new Error('INTENTIONAL_CONSTRUCTION_ROLLBACK');
 },{timeout:90000,maxWait:10000});}catch(e){if(e.message!=='INTENTIONAL_CONSTRUCTION_ROLLBACK')throw e;rolled=true;}
 assert(rolled);assert.equal(await db.constructionActivity.count(),beforeAudit);assert.equal((await db.constructionProgress.findUnique({where:{id:beforeEntry.id}})).version,beforeEntry.version);assert.equal((await db.constructionBudgetItem.findUnique({where:{id:beforeItem.id}})).version,beforeItem.version);assert.equal(await db.constructionClaim.count({where:{number:'ROLLBACK-TEST'}}),0);
 const sessions={};const jwt=new JwtService();for(const role of ['ADMIN','ACCOUNTING','SALES','MANAGER','AFTERSALES','CALLCENTER','PREVIEW']){const user=role==='ADMIN'?admin:await db.user.findFirst({where:{role,isActive:true},select:{id:true,name:true,role:true}});if(user)sessions[role]={user,token:jwt.sign({sub:user.id,role:user.role},{secret:process.env.JWT_ACCESS_SECRET,expiresIn:'45m'})};}
 fs.writeFileSync('/private/tmp/construction-test-sessions.json',JSON.stringify(sessions),{mode:0o600});
 const api=process.env.CONSTRUCTION_TEST_API||'http://localhost:3003';const request=async(role,path,method='GET',body)=>fetch(api+'/construction'+path,{method,headers:{...(role?{authorization:'Bearer '+sessions[role].token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request(null,'/workspace')).status,401);const http={};for(const role of Object.keys(sessions)){const response=await request(role,'/workspace');http[role]=response.status;assert.equal(response.status,['ADMIN','ACCOUNTING'].includes(role)?200:403);if(role==='ACCOUNTING')assert.equal((await request(role,`/units/${unit.id}/entries/${beforeEntry.id}`,'PATCH',{version:beforeEntry.version})).status,403);}
 assert.equal((await request('ADMIN','/projects/does-not-exist')).status,404);
 const snapshots=await db.constructionSource.findMany({select:{id:true,fileName:true,sha256:true}});
 const result={checkedAt:new Date().toISOString(),rollbackVerified:rolled,checks:29,http,projects:workspace.projects.map(p=>({id:p.id,progress:p.progress,unitCount:p.unitCount,openIssues:p.openIssues})),budget:budget.totals,claim:claim.totals,sources:snapshots};fs.writeFileSync('../artifacts/perla-excel-review-20261022/construction-verification.json',JSON.stringify(result,null,2));fs.writeFileSync('/private/tmp/construction-ui-fixtures.json',JSON.stringify({workspace,perla:p,perla2:p2,unit,claim,budget}));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await db.$disconnect();await pool.end();});
