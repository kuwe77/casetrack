import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
type Conversation={id:string;participantId:string;participantName:string;lastMessage:string;updatedTime:string};
type Message={id:string;body:string;direction:string;created_at:string;status:string;attachments:{type:string;url:string;name:string}[]};
type Page<T>={data:T[];nextCursor:string|null};
export function WhatsAppInbox({onRecipient}:{onRecipient:(phone:string)=>void}) {
  const [connected,setConnected]=useState(false),[conversations,setConversations]=useState<Conversation[]>([]);
  const [selected,setSelected]=useState<Conversation|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const [cursor,setCursor]=useState<string|null>(null),[messageCursor,setMessageCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function loadConversations(next?:string) {
    const page=await api<Page<Conversation>>(`/whatsapp/conversations${next?`?cursor=${encodeURIComponent(next)}`:""}`);
    setConversations(old=>next?[...new Map([...old,...page.data].map(c=>[c.id,c])).values()]:page.data);setCursor(page.nextCursor);
  }
  async function loadMessages(conversation:Conversation,next?:string) {
    const page=await api<Page<Message>>(`/whatsapp/conversations/${encodeURIComponent(conversation.id)}/messages${next?`?cursor=${encodeURIComponent(next)}`:""}`);
    setSelected(conversation);setMessages(old=>next?[...new Map([...old,...page.data].map(m=>[m.id,m])).values()]:page.data);setMessageCursor(page.nextCursor);
  }
  async function act(work:()=>Promise<void>) {
    setBusy(true);setError("");
    try {await work();} catch(e) {setError(errorMessage(e));} finally {setBusy(false);}
  }
  useEffect(()=>{void act(async()=>{
    const connection=await api<{provider:string}>("/whatsapp/connection");
    setConnected(connection.provider==="zernio");
    if(connection.provider==="zernio") await loadConversations();
  });},[]);
  if (!connected && !error) return null;
  return <Card className="wa-card"><div className="page-heading"><div><h2>Connected WhatsApp inbox</h2><p>Messages from your firm’s Zernio account. Opening a conversation does not send a read receipt.</p></div><Button variant="outline" disabled={busy} onClick={()=>void act(async()=>{await loadConversations();if(selected)await loadMessages(selected);})}>Refresh inbox</Button></div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-2"><div className="max-h-[32rem] overflow-y-auto space-y-2">{conversations.map(c=><button type="button" disabled={busy} className="w-full rounded-lg border p-3 text-left hover:bg-muted" aria-pressed={selected?.id===c.id} key={c.id} onClick={()=>void act(()=>loadMessages(c))}>
      <strong className="block">{c.participantName||c.participantId}</strong><small>{c.participantId}</small><p className="truncate text-sm">{c.lastMessage}</p>
    </button>)}{!conversations.length&&!busy&&<p>No conversations found.</p>}
      {cursor&&<Button variant="outline" disabled={busy} onClick={()=>void act(()=>loadConversations(cursor))}>Load more conversations</Button>}
    </div><div>{selected?<><h3>{selected.participantName||selected.participantId}</h3><Button className="my-3" variant="outline" onClick={()=>onRecipient(`+${selected.participantId.replace(/\D/g,"")}`)}>Use this recipient in compose</Button><div className="max-h-[32rem] overflow-y-auto space-y-3">{messages.map(m=><article className="rounded-lg border p-3" key={m.id}>
      <div className="flex justify-between gap-3 text-sm"><strong>{m.direction}</strong><span>{m.status}</span></div><small>{new Date(m.created_at).toLocaleString()}</small><p className="whitespace-pre-wrap break-words mt-2">{m.body}</p>
      {m.attachments.map((a,i)=>a.url?<a className="text-link block" target="_blank" rel="noreferrer" href={a.url} key={i}>{a.name||`${a.type} attachment`}</a>:<p key={i}>{a.type} attachment</p>)}
    </article>)}</div>{messageCursor&&<Button className="mt-3" variant="outline" disabled={busy} onClick={()=>void act(()=>loadMessages(selected,messageCursor))}>Load older messages</Button>}</>:<p className="vault-help">Select a conversation to view its messages and delivery status.</p>}</div></div>
  </Card>;
}
