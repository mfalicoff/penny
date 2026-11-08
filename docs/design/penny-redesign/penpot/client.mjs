// Uses the user's existing Penpot MCP configuration. Never prints or copies its URL.
import fs from 'node:fs/promises';
import os from 'node:os';

export async function connectPenpot({timeoutMs=240000}={}){
 const file=`${process.env.CODEX_HOME||`${os.homedir()}/.codex`}/config.toml`;
 const source=await fs.readFile(file,'utf8');
 const section=source.split(/(?=^\[)/m).find(value=>/^\[mcp_servers\.penpot\]\s*$/m.test(value));
 const value=section?.match(/^url\s*=\s*(.+)$/m)?.[1]?.trim();
 if(!value)throw new Error('Penpot is not configured in the current Codex home.');
 const url=value.startsWith('"')?JSON.parse(value):value.slice(1,-1);
 const token=new URL(url).searchParams.get('userToken');
 const redact=value=>{let result=String(value).replaceAll(url,'[Penpot URL redacted]');if(token)result=result.replaceAll(token,'[token redacted]');return result;};
 let sessionId,protocolVersion,requestId=0;
 function parse(body){
  try{return JSON.parse(body);}catch{}
  const messages=body.split(/\r?\n\r?\n/).map(block=>block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n')).filter(Boolean);
  for(const message of messages.reverse()){try{const parsed=JSON.parse(message);if('result' in parsed||'error' in parsed)return parsed;}catch{}}
  throw new Error('Penpot returned an unreadable MCP response.');
 }
 async function readResponse(response,id){
  if(!response.body)return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',complete='';
  const eventStream=(response.headers.get('content-type')||'').includes('text/event-stream');
  try{
   while(true){
    const {value,done}=await reader.read();
    if(value){const chunk=decoder.decode(value,{stream:true});pending+=chunk;complete+=chunk;}
    if(eventStream){
     let separator;
     while((separator=pending.match(/\r?\n\r?\n/))){
      const event=pending.slice(0,separator.index);pending=pending.slice(separator.index+separator[0].length);
      const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
      if(!data)continue;
      let parsed;try{parsed=JSON.parse(data);}catch{continue;}
      if(parsed.id===id&&('result' in parsed||'error' in parsed)){await reader.cancel();return parsed;}
     }
    }else{
     try{const parsed=JSON.parse(pending);if(parsed.id===id&&('result' in parsed||'error' in parsed)){await reader.cancel();return parsed;}}catch{}
    }
    if(done)break;
   }
   return complete?parse(complete):null;
  }finally{reader.releaseLock();}
 }
 async function rpc(method,params,notification=false){
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  if(sessionId)headers['Mcp-Session-Id']=sessionId;
  if(protocolVersion)headers['MCP-Protocol-Version']=protocolVersion;
  const id=notification?undefined:++requestId;
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params}),signal:AbortSignal.timeout(timeoutMs)});
  sessionId=response.headers.get('mcp-session-id')||sessionId;
  if(!response.ok)throw new Error(redact(`Penpot HTTP ${response.status}: ${(await response.text()).slice(0,500)}`));
  if(notification){await response.body?.cancel();return null;}
  const result=await readResponse(response,id);if(!result)return null;if(result.error)throw new Error(redact(JSON.stringify(result.error)));return result.result;
 }
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'penny-redesign-import',version:'1.0.0'}});
 protocolVersion=init.protocolVersion;await rpc('notifications/initialized',{},true);
 return {
  server:init.serverInfo,
  async listTools(){return rpc('tools/list',{});},
  async raw(name,args={}){return rpc('tools/call',{name,arguments:args});},
  async call(name,args={}){
   const result=await rpc('tools/call',{name,arguments:args});
   const text=(result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
   if(result.isError||/Tool execution failed:|^Error:/m.test(text))throw new Error(redact(text));
   if(result.structuredContent)return result.structuredContent;
   try{return JSON.parse(text);}catch{return text;}
  },
  async code(code){
   const response=await this.call('execute_code',{code});
   return response&&typeof response==='object'&&'result' in response&&'log' in response?response.result:response;
  },
 };
}
