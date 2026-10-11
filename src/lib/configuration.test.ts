import { describe, it, expect } from "vitest";
import { configurationIssue } from "./configuration";
describe("public deployment configuration", () => {
  it("requires both connection values", () => {
    expect(configurationIssue()).toBeTruthy();
    expect(configurationIssue("https://test.supabase.co")).toBeTruthy();
  });
  it("accepts only hosted Supabase HTTPS URLs", () => {
    for (const url of [
      "http://test.supabase.co",
      "https://test.supabase.co.attacker.example",
      "javascript:alert(1)",
      "https://user:pass@test.supabase.co",
    ])
      expect(configurationIssue(url, "sb_publishable_example")).toBeTruthy();
  });
  it("rejects secret and legacy JWT keys before the build bundles them", () => {
    for (const key of [
      "sb_secret_not-public",
      "eyJhbGciOiJIUzI1NiJ9.fake-signature",
    ])
      expect(configurationIssue("https://test.supabase.co", key)).toBeTruthy();
  });
  it("accepts a hosted project with a publishable key", () => {
    expect(
      configurationIssue("https://test.supabase.co", "sb_publishable_example"),
    ).toBeNull();
  });
});
