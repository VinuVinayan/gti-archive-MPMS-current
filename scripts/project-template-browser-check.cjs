// Optional real-browser checks. See docs/project-template-engine/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'file:///missing');
const base = process.env.TEMPLATE_BROWSER_URL || 'http://127.0.0.1:3100';
assert(['127.0.0.1', 'localhost'].includes(database.hostname), 'Explicit local DATABASE_URL required');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local app URL required');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const {prisma} = require('../.tmp/project-template-engine/src/lib/prisma.js');
const {createProjectV2} = require('../.tmp/project-template-engine/src/lib/project-creation.js');
const {newStageDefinition} = require('../.tmp/project-template-engine/src/lib/project-template-definitions.js');
const run = randomUUID();
const ids = Object.fromEntries(['owner','executor','coowner','director'].map(key=>[key,`template-browser-${key}-${run}`]));
const fixture = {tokens:{},projects:{}};
const output = path.resolve('.tmp/template-browser');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;
 const errors=[];
 try {
  for(const [key,role] of [['owner','USER'],['executor','USER'],['director','SUPER_ADMIN'],['coowner','ADMIN']]) {
   const id=ids[key];
   await prisma.user.create({data:{id,email:id+'@example.test',name:key,passwordHash:'browser-fixture-only',role,projectCreationAccessGranted:key==='owner'}});
   const token=randomUUID();
   await prisma.session.create({data:{token,userId:id,expiresAt:new Date(Date.now()+3600000)}});
   fixture.tokens[id]=token;
  }
  for(const key of ['PACKAGING','POSM','RETAIL','EXHIBITION','DIGITAL','CUSTOM']) {
   const result=await createProjectV2({id:ids.owner,role:'USER',projectCreationAccessGranted:true},{name:'Browser QA '+key,ownerId:ids.owner,coOwnerIds:[ids.coowner],executorIds:[ids.executor],templateKey:key,customStages:key==='CUSTOM'?Array.from({length:12},(_,i)=>newStageDefinition('Stage '+(i+1)+' with an unusually long name to verify wrapping and consistent cards across every viewport')):undefined});
   assert('projectId' in result,JSON.stringify(result));
   fixture.projects[key]=result.projectId;
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  async function actor(id){
   const context=await browser.newContext({viewport:{width:1440,height:1100}});
   await context.addCookies([{name:'gti_session',value:fixture.tokens[id],domain:new URL(base).hostname,path:'/'}]);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
  }
 const owner=await actor(ids.owner);
 await owner.goto(base+'/projects/new');await owner.getByLabel('Project Type / Template').waitFor();
 for(const [key,count] of [['PACKAGING',8],['POSM',6],['RETAIL',7],['EXHIBITION',8],['DIGITAL',8]]){await owner.selectOption('#project-template',key);assert.equal(await owner.locator('form ol li').count(),count);}
 await owner.screenshot({path:path.join(output,'create.png'),fullPage:true});
 await owner.selectOption('#project-template','POSM');await owner.fill('#project-name','Browser-created POSM');await owner.getByText('Manage this project myself',{exact:true}).click();await owner.getByRole('button',{name:'Create Project',exact:true}).click();await owner.waitForURL(/\/projects\/[^/]+$/);await owner.getByRole('heading',{name:'Project stages',exact:true}).waitFor();assert.equal(await owner.locator('article:visible').count(),6);
 await owner.getByRole('link',{name:'Open Stage'}).first().click();await owner.getByLabel('Stage notes',{exact:true}).fill('Browser verified generic notes.');await owner.getByRole('button',{name:'Save notes',exact:true}).click();await owner.getByRole('button',{name:'Complete stage',exact:true}).waitFor();await owner.getByRole('button',{name:'Complete stage',exact:true}).click();await owner.waitForURL(/\/projects\/[^/]+$/);await owner.getByRole('heading',{name:'Project stages',exact:true}).waitFor();assert.equal(await owner.getByRole('link',{name:'Open Stage'}).count(),2);
 await owner.goto(base+'/projects/'+fixture.projects.CUSTOM);await owner.getByRole('heading',{name:'Project stages',exact:true}).waitFor();assert.equal(await owner.locator('article:visible').count(),12);
 for(const width of [1440,768,390]){await owner.setViewportSize({width,height:1100});await owner.waitForTimeout(700);const metrics=await owner.locator('article:visible').evaluateAll(nodes=>nodes.map(n=>({h:n.getBoundingClientRect().height,heading:n.querySelector('h2').getBoundingClientRect().height})));console.log(width,JSON.stringify(metrics));assert(metrics.every(m=>Math.abs(m.h-260)<1 && m.heading<=44));assert(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await owner.screenshot({path:path.join(output,`overview-${width}.png`),fullPage:true});}
 const coowner=await actor(ids.coowner);await coowner.goto(base+'/projects/'+fixture.projects.PACKAGING);await coowner.getByRole('heading',{name:'Project stages',exact:true}).waitFor();assert.equal(await coowner.locator('article:visible').count(),8);
 const executor=await actor(ids.executor);for(const url of ['/projects/'+fixture.projects.PACKAGING,'/projects/'+fixture.projects.PACKAGING+'/stages/1','/projects/'+fixture.projects.POSM]){await executor.goto(base+''+url,{waitUntil:'networkidle'});assert.equal(await executor.getByRole('heading',{name:'Project stages',exact:true}).count(),0);assert.equal(await executor.getByRole('link',{name:'Open Stage'}).count(),0);}
 const director=await actor(ids.director);await director.goto(base+'/settings/project-templates');await director.getByRole('heading',{name:'Project templates',exact:true}).waitFor();await director.goto(base+'/projects/'+fixture.projects.CUSTOM+'/structure');if(await director.getByRole('button',{name:'Approve project structure',exact:true}).count()) await director.getByRole('button',{name:'Approve project structure',exact:true}).click();await director.getByText('Revision 1 · Approved',{exact:true}).waitFor();
 await owner.goto(base+'/projects/'+fixture.projects.PACKAGING+'/stages/1');await owner.getByRole('heading',{name:'Stage 1 - Project Inquiry',exact:true}).waitFor();await owner.locator('summary:visible').filter({hasText:'What now?'}).first().waitFor();
 
  assert.deepEqual(errors,[]);
  console.log('PASS: template previews, project creation, progression, permissions, Director approval and responsive 12-stage overview; no browser errors.');
 } finally {
  await browser?.close();
  await prisma.project.deleteMany({where:{createdById:ids.owner}});
  await prisma.user.deleteMany({where:{id:{in:Object.values(ids)}}});
  await prisma.$disconnect();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
