import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPenpot } from './client.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state=JSON.parse(await fs.readFile(path.join(root,'penpot-state.json'),'utf8'));
const client=await connectPenpot();
const ids=process.argv.slice(2);
if(!ids.length)throw new Error('Pass logical screen IDs from screen-inventory.json.');
for(const id of ids){
 const shapeId=state.screens[id];
 if(!shapeId)throw new Error('No imported screen ID for '+id);
 const result=await client.raw('export_shape',{shapeId,format:'png'});
 const image=result.content?.find(item=>item.type==='image');
 if(result.isError||!image)throw new Error('Native Penpot export failed for '+id);
 const destination=path.join(root,'previews','penpot-'+id+'.png');
 await fs.writeFile(destination,Buffer.from(image.data,'base64'));
 console.log('Saved native preview: '+path.relative(root,destination));
}
