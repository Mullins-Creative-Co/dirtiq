import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [candidatesPath,outputPath]=process.argv.slice(2);
if(!candidatesPath || !outputPath) throw new Error('Usage: node scripts/fetch_mrp_gap_snapshots.mjs candidates.json output.json');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dirtiq-gap-'));
const parserPath=path.join(temp,'parser.ts');
fs.writeFileSync(parserPath,fs.readFileSync(new URL('../src/lib/mrp-lineup.ts',import.meta.url),'utf8').replace('import "server-only";',''));
const {parseMrpEventPage}=await import(pathToFileURL(parserPath).href);
const run=promisify(execFile);
const queue=JSON.parse(fs.readFileSync(candidatesPath,'utf8'));
const output=[];
async function worker(){while(queue.length){const race=queue.shift();try{
const url=`https://www.myracepass.com/events/${race.mrp_event_id}/races`;
const {stdout:html}=await run('curl',['-fsSL','--max-time','25','-A','Mozilla/5.0',url],{encoding:'utf8',maxBuffer:10000000});
const parsed=parseMrpEventPage(html);
output.push({race,url,eventName:parsed.event_name,sessions:parsed.sessions.filter(s=>/late model|lolmds/i.test(s.name)&& !/604|602|crate|limited|pro late/i.test(s.name))});
}catch(e){output.push({race,error:String(e)});}
fs.writeFileSync(outputPath,JSON.stringify(output,null,2));
if(output.length%20===0) console.log('Fetched',output.length,'remaining',queue.length);
}}
await Promise.all([worker(),worker(),worker(),worker()]);
console.log('Done',output.length);

fs.rmSync(temp,{recursive:true,force:true});
