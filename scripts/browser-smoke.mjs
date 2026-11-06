import assert from 'node:assert/strict';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
const downloads=await mkdtemp(join(tmpdir(),'xml-weaver-downloads-'));
async function downloaded(suffix) {
  for (let attempt=0;attempt<100;attempt++) {
    const name=(await readdir(downloads)).find(name=>name.endsWith(suffix));
    if(name) return readFile(join(downloads,name),'utf8');
    await pause(50);
  }
  throw new Error(`Download did not complete: ${suffix}`);
}

const server = await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  const session=await page.createCDPSession();
  await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForSelector('[data-action="load-demo"]');
  await page.click('[data-action="load-demo"]');
  assert.equal(await page.$$eval('.tab', elements=>elements.length),6);
  // Exercise actual controller actions via the Vite module, sharing the mounted instance.
  const injection = await page.evaluate(async()=>{
    const app=await import('/src/app.ts');
    const root=structuredClone(app.state.documents.find(doc=>doc.kind==='xml').root);
    root.id='x"><img src=x onerror="globalThis.injected=true">';
    app.addDocument(app.createDraftDocument('hostile.json',JSON.stringify({root})));
    return {hasImage:!!document.querySelector('img'),executed:!!globalThis.injected};
  });
  assert.deepEqual(injection,{hasImage:false,executed:false});
  // Opening a search palette and moving through results must retain focus/caret.
  await page.click('[data-action="new-document"]');
  await page.waitForSelector('[data-palette-input]');
  await page.type('[data-palette-input]','xml');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-palette-input')),true);
  await page.keyboard.type('x');
  assert.equal(await page.$eval('[data-palette-input]', element=>element.value),'xmlx');
  await page.keyboard.press('Escape');
  // Native selects must retain ArrowDown behavior without moving tree selection.
  await page.focus('[data-action="schema-link"]');
  const selected=await page.evaluate(async()=>(await import('/src/app.ts')).state.documents.at(-1).selectedId);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(async()=>(await import('/src/app.ts')).state.documents.at(-1).selectedId),selected);
  const transaction=await page.evaluate(async()=>{
    const app=await import('/src/app.ts');
    const doc=app.state.documents.at(-1);
    doc.schemaRequired=false; doc.schemaId=null;doc.mode='freeform';
    const before=doc.root.text;
    const accepted=app.commitDocumentEdit(doc,()=>{doc.root.text='changed';});
    app.undoDocumentEdit();
    const undone=doc.root.text===before;
    app.undoDocumentEdit(true);
    return {accepted,undone,redone:doc.root.text==='changed',dirty:app.hasUnsavedChanges(doc)};
  });
  assert.deepEqual(transaction,{accepted:true,undone:true,redone:true,dirty:true});
  // Recovery restores without depending on old session schema IDs.
  page.on('dialog',dialog=>dialog.accept());
  await page.reload();
  await page.waitForSelector('.tab');
  assert.match(await page.$eval('.statusbar',element=>element.textContent),/Recovered/);
  await page.click('[data-action="save-draft"]');
  const saved=JSON.parse(await downloaded('.draft.json'));
  assert.equal(saved.formatVersion,1);
  assert.equal(saved.root.text,'changed');
  await page.click('[data-action="export"]');
  assert.match(await downloaded('.xml'),/changed/);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: demos, hostile draft, palette focus, native select, transactions, undo/redo recovery and downloads.');
} finally {
  if(browser) await browser.close();
  await server.close();
  await rm(downloads,{recursive:true,force:true});
}
