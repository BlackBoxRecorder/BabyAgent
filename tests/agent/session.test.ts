/**
 * Tests for SessionManager — JSONL session persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager, type TurnRecord } from "../../src/session.js";
import type { Message } from "../../src/llm/index.js";

// Helper to create a test user message
function userMsg(content: string): Message {
  return { role: "user", content };
}

// Helper to create a test assistant message
function assistantMsg(content: string): Message {
  return { role: "assistant", content };
}

// Helper to create a turn record
function makeTurn(
  userInput: string,
  extraMessages: Message[] = [],
): TurnRecord {
  return {
    type: "turn",
    timestamp: new Date().toISOString(),
    userInput,
    messages: [userMsg(userInput), ...extraMessages],
  };
}

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `deepcode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    manager = new SessionManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ====================================================================
  // createSession
  // ====================================================================

  describe("createSession", () => {
    it("should create a session file and return meta", async () => {
      const meta = await manager.createSession("Hello world");
      expect(meta.title).toBe("Hello world");
      expect(meta.id).toBeTruthy();
      expect(meta.id).toMatch(/^[0-9a-f]{8}-/); // 8 hex chars + dash
      expect(meta.turnCount).toBe(0);
      expect(meta.createdAt).toBe(meta.updatedAt);

      // Verify file exists and has meta line
      const files = await fs.readdir(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(meta.id);
    });

    it("should truncate title to 50 characters", async () => {
      const longInput = "A".repeat(100);
      const meta = await manager.createSession(longInput);
      expect(meta.title.length).toBe(50);
    });

    it("should create the sessions directory if it does not exist", async () => {
      const nestedDir = path.join(tmpDir, "nested", "sessions");
      const mgr = new SessionManager(nestedDir);
      await mgr.createSession("test");
      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  // ====================================================================
  // appendTurn
  // ====================================================================

  describe("appendTurn", () => {
    it("should append a turn and update meta (updatedAt, turnCount)", async () => {
      const meta = await manager.createSession("First question");
      const originalUpdatedAt = meta.updatedAt;

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      const turn = makeTurn("First question", [assistantMsg("Answer")]);
      await manager.appendTurn(meta.id, turn);

      // Reload meta
      const updatedMeta = await manager.getSessionMeta(meta.id);
      expect(updatedMeta).not.toBeNull();
      expect(updatedMeta!.turnCount).toBe(1);
      expect(updatedMeta!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("should accumulate tens of thousands of turns correctly", async () => {
      const meta = await manager.createSession("Multi turn");
      const turnCount = 3;

      for (let i = 0; i < turnCount; i++) {
        const turn = makeTurn(`Question ${i + 1}`, [
          assistantMsg(`Answer ${i + 1}`),
        ]);
        await manager.appendTurn(meta.id, turn);
      }

      const updatedMeta = await manager.getSessionMeta(meta.id);
      expect(updatedMeta!.turnCount).toBe(turnCount);

      // Load all messages
      const messages = await manager.loadMessages(meta.id);
      // Each turn: user + assistant = 2 messages, 3 turns = 6 messages
      expect(messages).toHaveLength(turnCount * 2);
      expect(messages[0]).toEqual(userMsg("Question 1"));
      expect(messages[1]).toEqual(assistantMsg("Answer 1"));
      expect(messages[4]).toEqual(userMsg("Question 3"));
      expect(messages[5]).toEqual(assistantMsg("Answer 3"));
    });
  });

  // ====================================================================
  // updateTitle
  // ====================================================================

  describe("updateTitle", () => {
    it("should change the session title", async () => {
      const meta = await manager.createSession("Old title");
      await manager.updateTitle(meta.id, "New title");

      const updated = await manager.getSessionMeta(meta.id);
      expect(updated!.title).toBe("New title");
    });

    it("should preserve other fields when updating title", async () => {
      const meta = await manager.createSession("Original");
      await manager.updateTitle(meta.id, "Renamed");

      const updated = await manager.getSessionMeta(meta.id);
      expect(updated!.id).toBe(meta.id);
      expect(updated!.createdAt).toBe(meta.createdAt);
      expect(updated!.turnCount).toBe(meta.turnCount);
    });
  });

  // ====================================================================
  // listSessions
  // ====================================================================

  describe("listSessions", () => {
    it("should return empty array when no sessions exist", async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should list sessions sorted by updatedAt descending", async () => {
      const m1 = await manager.createSession("Session 1");
      await new Promise((r) => setTimeout(r, 10));
      const m2 = await manager.createSession("Session 2");

      // m2 should come first (more recent)
      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(m2.id);
      expect(sessions[1].id).toBe(m1.id);
    });

    it("should reflect turn count in listed sessions", async () => {
      const meta = await manager.createSession("test");
      await manager.appendTurn(meta.id, makeTurn("Q1", [assistantMsg("A1")]));
      await manager.appendTurn(meta.id, makeTurn("Q2", [assistantMsg("A2")]));

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].turnCount).toBe(2);
    });

    it("should skip non-jsonl files and corrupted files gracefully", async () => {
      // Create a non-jsonl file
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, "readme.txt"), "hello");

      const meta = await manager.createSession("legit");
      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(meta.id);
    });
  });

  // ====================================================================
  // loadMessages
  // ====================================================================

  describe("loadMessages", () => {
    it("should return messages from all turns concatenated", async () => {
      const meta = await manager.createSession("Chat");

      await manager.appendTurn(meta.id, makeTurn("Q1", [assistantMsg("A1")]));
      await manager.appendTurn(meta.id, makeTurn("Q2", [assistantMsg("A2")]));

      const messages = await manager.loadMessages(meta.id);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual(userMsg("Q1"));
      expect(messages[1]).toEqual(assistantMsg("A1"));
      expect(messages[2]).toEqual(userMsg("Q2"));
      expect(messages[3]).toEqual(assistantMsg("A2"));
    });

    it("should skip malformed lines gracefully", async () => {
      const meta = await manager.createSession("Chat");
      const filePath = path.join(tmpDir, `${meta.id}.jsonl`);

      // Append a turn normally
      await manager.appendTurn(meta.id, makeTurn("Q1", [assistantMsg("A1")]));

      // Corrupt the file by appending garbage
      await fs.appendFile(filePath, "this is not valid json\n");

      // Append another valid turn
      const turn2 = makeTurn("Q2", [assistantMsg("A2")]);
      await manager.appendTurn(meta.id, turn2);

      // Should still load the valid turns
      const messages = await manager.loadMessages(meta.id);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual(userMsg("Q1"));
    });
  });

  // ====================================================================
  // getSessionMeta
  // ====================================================================

  describe("getSessionMeta", () => {
    it("should return null for non-existent session", async () => {
      const result = await manager.getSessionMeta("nonexistent");
      expect(result).toBeNull();
    });

    it("should return meta for existing session", async () => {
      const created = await manager.createSession("My session");
      const fetched = await manager.getSessionMeta(created.id);
      expect(fetched).toEqual(created);
    });
  });

  // ====================================================================
  // Integration: full lifecycle
  // ====================================================================

  describe("integration", () => {
    it("should support full lifecycle: create → append → list → load → continue", async () => {
      // Create
      const meta = await manager.createSession("Lifecycle test");
      expect(meta.turnCount).toBe(0);

      // Append turns
      await manager.appendTurn(meta.id, makeTurn("Q1", [assistantMsg("A1")]));
      await manager.appendTurn(meta.id, makeTurn("Q2", [assistantMsg("A2")]));

      // List
      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].turnCount).toBe(2);

      // Load
      const messages = await manager.loadMessages(meta.id);
      expect(messages).toHaveLength(4);

      // Simulate "continuing": load messages, prepend system, add new user
      const systemMsg: Message = {
        role: "system",
        content: "You are helpful.",
      };
      const newUserMsg: Message = { role: "user", content: "Q3" };
      const combined = [systemMsg, ...messages, newUserMsg];
      expect(combined).toHaveLength(6);
      expect(combined[0]).toEqual(systemMsg);
      expect(combined[5]).toEqual(newUserMsg);
    });
  });
});
