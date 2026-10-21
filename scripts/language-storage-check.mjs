import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const entry = new URL('../src/i18n/index.js', import.meta.url).href;
for (const mode of ['getter-denied','read-denied','write-denied','missing','available']) {
  const source = `
    import assert from 'node:assert/strict';
    const mode=${JSON.stringify(mode)};
    const values=new Map([['vratimeLanguage','de']]);
    globalThis.window={navigator:{languages:['en-US'],language:'en-US'}};
    globalThis.document={documentElement:{lang:''}};
    const storage={getItem(key){if(mode==='read-denied')throw new Error('Storage denied');return values.get(key)||null},setItem(key,value){if(mode==='write-denied')throw new Error('Storage quota');values.set(key,value)}};
    Object.defineProperty(window,'localStorage',{get(){if(mode==='getter-denied')throw new Error('Storage denied');return mode==='missing'?undefined:storage}});
    const {default:i18n,getAppLanguage,setAppLanguage}=await import(${JSON.stringify(entry)});
    assert.equal(getAppLanguage(),['write-denied','available'].includes(mode)?'de':'en');
    await setAppLanguage('fr');
    assert.equal(getAppLanguage(),'fr');assert.equal(document.documentElement.lang,'fr');
    if(mode==='available')assert.equal(values.get('vratimeLanguage'),'fr');
    console.log('PASS language storage '+mode);
  `;
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--input-type=module','-e',source],{stdio:'pipe'}),`App must load and change language when ${mode}`);
}
console.log('Language storage: five fresh-module browser storage cases passed.');
