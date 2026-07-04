import { describe, it, expect } from "vitest";
import { isSrcEmpty, hasNameCollision, truncateSrc, prepareInstallAction } from "./skill-row";
import type { InstalledSkill } from "./installer";
import * as path from "path";

describe("isSrcEmpty", () => {
  it("true for empty / whitespace", () => {
    expect(isSrcEmpty("")).toBe(true);
    expect(isSrcEmpty("   ")).toBe(true);
    expect(isSrcEmpty("\n")).toBe(true);
  });
  it("false for non-empty", () => {
    expect(isSrcEmpty("a/b")).toBe(false);
    expect(isSrcEmpty(" a/b ")).toBe(false);
  });
});

describe("hasNameCollision", () => {
  const skill: InstalledSkill = { name: "foo", src: "x/y/z/foo#main", dest: "/d/foo" };
  it("true when same name", () => {
    expect(hasNameCollision([skill], "foo")).toBe(true);
  });
  it("false otherwise", () => {
    expect(hasNameCollision([skill], "bar")).toBe(false);
    expect(hasNameCollision([], "foo")).toBe(false);
  });
});

describe("truncateSrc", () => {
  it("returns src unchanged when shorter than max", () => {
    expect(truncateSrc("a/b/c", 60)).toBe("a/b/c");
  });
  it("truncates long src with ellipsis", () => {
    const long = "ZHLX2005/sl/skills/".padEnd(80, "x");
    const out = truncateSrc(long, 60);
    expect(out.length).toBe(60);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("prepareInstallAction", () => {
  it("empty src → ok:false", () => {
    const r = prepareInstallAction([], "/v", "  ");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/源不能为空/);
  });
  it("invalid chars → ok:false with derive error", () => {
    const r = prepareInstallAction([], "/v", "a/b/c d#main");
    expect(r.ok).toBe(false);
  });
  it("name collision → ok:false with collision reason", () => {
    const existing: InstalledSkill[] = [
      { name: "foo", src: "a/b/foo#main", dest: "/v/.claude/skills/foo" },
    ];
    const r = prepareInstallAction(existing, "/v", "x/y/skills/foo#main");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已存在同名 skill「foo」/);
  });
  it("happy path → ok:true with derived args", () => {
    const r = prepareInstallAction([], "/v", "owner/repo/skills/foo#main");
    expect(r.ok).toBe(true);
    expect(r.args?.name).toBe("foo");
    expect(r.args?.dest).toBe(path.join("/v", ".claude", "skills", "foo"));
  });
});