// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Workspace } from "../lib/model";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../lib/api", () => ({ api: mocks.api, send: vi.fn() }));
import { WhatsAppPage } from "./whatsapp-page";
afterEach(cleanup);
it("does not request or expose provider credentials for a member", async () => {
  mocks.api.mockImplementation(async (path: string) => path === "/me" ? { role:"member" } : { data:[], nextCursor:null });
  render(<WhatsAppPage w={{agents:[],cases:[],tasks:[],activities:[],firm:{id:"f",name:"Firm",email:""}} as Workspace}/>);
  await screen.findByText("No messages yet.");
  expect(mocks.api.mock.calls.some(([path]) => path === "/whatsapp/settings")).toBe(false);
  expect(screen.queryByText("Save connection")).toBeNull();
});
