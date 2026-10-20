import { describe, expect, it, vi } from "vitest";
import { ZernioClient, ZernioError } from "../cloudflare/zernio";

const accountId="account_test_a";
const conversation={id:"opaque/thread:123",accountId,platform:"whatsapp",participantId:"60194816505",participantName:"Test"};
describe("Zernio account and inbox boundary",()=>{
  it("does not bind Workers global fetch to the Zernio client instance",async()=>{
    vi.stubGlobal("fetch",function(this:unknown,_input:unknown,init?:RequestInit){
      if (this!==undefined && this!==globalThis) throw new TypeError("Illegal invocation");
      if(init?.redirect==="error") throw new TypeError("Workers does not support redirect:error");
      expect(init?.redirect).toBe("manual");
      return Promise.resolve(Response.json({accounts:[{_id:accountId,platform:"whatsapp",isActive:true,username:"test"}]}));
    });
    try {expect((await new ZernioClient("secret",accountId).verify()).phone).toBe("test");}
    finally {vi.unstubAllGlobals();}
  });
  it("does not follow a provider redirect or transmit credentials to the redirect target",async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{Location:"https://other.example/"}}));
    await expect(new ZernioClient("secret",accountId,fetcher).verify()).rejects.toMatchObject({status:302});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(((fetcher.mock.calls as unknown[][])[0]![1] as RequestInit).redirect).toBe("manual");
  });
  it("verifies an active WhatsApp account without returning provider secrets",async()=>{
    const fetcher=vi.fn(async()=>Response.json({accounts:[{_id:accountId,platform:"whatsapp",isActive:true,username:"+60107816515",displayName:"Test",token:"do-not-return"}]}));
    expect(await new ZernioClient("secret",accountId,fetcher).verify()).toEqual({label:"Test",phone:"+60107816515"});
  });
  it("refuses an inactive account",async()=>{
    const fetcher=vi.fn(async()=>Response.json({accounts:[{_id:accountId,platform:"whatsapp",isActive:false}]}));
    await expect(new ZernioClient("secret",accountId,fetcher).verify()).rejects.toMatchObject({status:400});
  });
  it("keeps opaque pagination and pins the account filter",async()=>{
    const fetcher=vi.fn(async()=>Response.json({data:[conversation],pagination:{hasMore:true,nextCursor:"next&accountId=other"}}));
    const result=await new ZernioClient("secret",accountId,fetcher).conversations("previous?&",2);
    const url=new URL(String((fetcher.mock.calls as unknown[][])[0]![0]));
    expect(url.searchParams.get("accountId")).toBe(accountId);
    expect(url.searchParams.get("cursor")).toBe("previous?&");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(result.nextCursor).toBe("next&accountId=other");
  });
  it("rejects cross-account conversations even if the upstream filter fails",async()=>{
    const fetcher=vi.fn(async()=>Response.json({data:[{...conversation,accountId:"another_account"}],pagination:{hasMore:false}}));
    await expect(new ZernioClient("secret",accountId,fetcher).conversations()).rejects.toMatchObject({status:404});
  });
  it("refuses partial provider failures and missing pagination cursors",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({data:[],meta:{accountsFailed:1}}))
      .mockResolvedValueOnce(Response.json({data:[],pagination:{hasMore:true,nextCursor:null}}));
    const client=new ZernioClient("secret",accountId,fetcher);
    await expect(client.conversations()).rejects.toBeInstanceOf(ZernioError);
    await expect(client.conversations()).rejects.toMatchObject({status:503});
  });
  it("checks conversation ownership before reading messages and removes unsafe attachment links",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({data:conversation})).mockResolvedValueOnce(Response.json({
      messages:[{id:"message1",accountId,platform:"whatsapp",direction:"incoming",message:"Hello",createdAt:"2026-10-20T06:00:00Z",
        attachments:[{type:"document",url:"javascript:alert(1)",name:"test"}]}],pagination:{hasMore:false},
    }));
    const result=await new ZernioClient("secret",accountId,fetcher).messages(conversation.id);
    expect(String(fetcher.mock.calls[0]![0])).toContain("opaque%2Fthread%3A123?");
    expect(result.data[0]).toMatchObject({body:"Hello",status:"received",attachments:[{url:""}]});
  });
  it("rejects a foreign account's message",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({data:conversation})).mockResolvedValueOnce(Response.json({
      messages:[{id:"m",accountId:"foreign",platform:"whatsapp",direction:"incoming"}],pagination:{hasMore:false},
    }));
    await expect(new ZernioClient("secret",accountId,fetcher).messages(conversation.id)).rejects.toMatchObject({status:404});
  });
  it("sends with the fixed account and idempotency key without exposing upstream errors",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({success:true,data:{messageId:"wamid.test",conversationId:"thread"}}))
      .mockResolvedValueOnce(new Response('{"secret":"provider-secret-value"}',{status:400}));
    const client=new ZernioClient("secret",accountId,fetcher);
    expect(await client.send("+60194816505","Test","stable-key",undefined,"thread")).toMatchObject({providerId:"wamid.test"});
    const init=fetcher.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(JSON.parse(String(init.body))).toEqual({accountId,message:"Test",linkPreview:false});
    await expect(client.send("+60194816505","Test","stable-key",undefined,"thread")).rejects.toThrow("WhatsApp provider request failed (400)");
  });
});
