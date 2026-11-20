/**
 * Integration tests for pi-status.ts extension.
 *
 * Tests:
 * 1.  Module loads and exports a default function
 * 2.  Only the 3 lifecycle handlers are registered
 * 3.  `session_start` → idle icon in title (deferred via setImmediate)
 * 4.  `agent_start` → spinner starts in title
 * 5.  `agent_settled` → idle icon restored, spinner stopped
 * 6.  `agent_settled` after an abort → idle icon, no further frames
 * 7.  `PI_STATUS_IDLE_ICON` overrides the idle icon
 * 8.  Context ≤50% → no indicator in title
 * 9.  Context >50% → [N%] in title
 * 10. Context ≥90% → ![N%]! in title
 * 11. Context null → no indicator
 * 12. Spinner never shows the context indicator
 * 13. Stale session: spinner tick throws no error and stops
 * 14. Stale session: `agent_start` arms no interval when the first frame fails
 * 15. Stale session: `agent_settled` still shows the idle icon
 */

import path from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

// ── Helpers ──────────────────────────────────────────────

/** Compute the expected base title dynamically based on current environment */
function getExpectedBaseTitle(): string {
    const cwd = path.basename(process.cwd())
    return `${cwd}`
}


const AGENT_ICON = "🤖"
const IDLE_ICON = "✔️"
process.env.PI_STATUS_AGENT_ICON = AGENT_ICON
process.env.PI_STATUS_IDLE_ICON = IDLE_ICON

const EXPECTED_BASE_TITLE = getExpectedBaseTitle()
const SPINNER_FRAME_REGEX = new RegExp(
    `^${AGENT_ICON} [\\u280B\\u2819\\u2839\\u2838\\u283C\\u2834\\u2826\\u2827\\u2807\\u280F] ${EXPECTED_BASE_TITLE.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`,
)

function createMockPi(): ExtensionAPI & { _handlers: Map<string, Function> } {
    const handlers = new Map<string, Function>()
    return {
        on: vi.fn((event: string, handler: Function) => {
            handlers.set(event, handler)
        }) as unknown as ExtensionAPI["on"],
        getSessionName: vi.fn(() => null) as unknown as ExtensionAPI["getSessionName"],
        _handlers: handlers,
    } as unknown as ExtensionAPI & { _handlers: Map<string, Function> }
}

function createMockCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
    const theme = {
        fg: vi.fn((_color: string, text: string) => `\x1b[32m${text}\x1b[0m`),
    }
    return {
        ui: {
            theme,
            setTitle: vi.fn(),
            setStatus: vi.fn(),
        } as unknown as ExtensionContext["ui"],
        getContextUsage: vi.fn(() => ({
            percent: 25,
            tokens: 25_000,
            contextWindow: 100_000,
        })),
        hasUI: true,
        ...overrides,
    } as ExtensionContext
}

// ── Module-level tests ───────────────────────────────────

describe("pi-status.ts module", () => {
    it("loads without errors", async () => {
        const mod = await import("./pi-status.ts")
        expect(typeof mod.default).toBe("function")
    })

    it("registers only the three lifecycle handlers", async () => {
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)
        const events = (mockPi.on as ReturnType<typeof vi.fn>).mock.calls.map((c: string[]) => c[0])
        expect(new Set(events)).toEqual(new Set(["session_start", "agent_start", "agent_settled"]))
    })
})

// ── Handler behaviour ────────────────────────────────────

describe("extension handlers", () => {
    let mockPi: ReturnType<typeof createMockPi>

    beforeEach(async () => {
        mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)
    })

    it("session_start: ≤50% context → no indicator in title (deferred via setImmediate)", async () => {
        const ctx = createMockCtx() // 25% ≤ 50%
        const handler = mockPi._handlers.get("session_start")!
        handler({ reason: "startup" }, ctx)

        // session_start defers to setImmediate so pi's init-based
        // updateTerminalTitle() fires first; wait for the deferred call.
        await new Promise((resolve) => setImmediate(resolve))
        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)
        expect(ctx.ui.setStatus).not.toHaveBeenCalled()
    })

    it("agent_start starts spinner in title", async () => {
        const ctx = createMockCtx()
        const handler = mockPi._handlers.get("agent_start")!
        await handler({}, ctx)

        await new Promise((r) => setTimeout(r, 150))

        expect(ctx.ui.setTitle).toHaveBeenCalled()
        const firstCall = (ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
        expect(firstCall).toMatch(SPINNER_FRAME_REGEX)
        expect(ctx.ui.setStatus).not.toHaveBeenCalled()
    })

    it("agent_settled restores green checkmark in title", async () => {
        const ctx = createMockCtx() // 25% ≤ 50%
        const handler = mockPi._handlers.get("agent_settled")!
        await handler({ aborted: false }, ctx)

        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)
    })

    it("agent_settled after an abort restores the idle title and stops the spinner", async () => {
        const ctx = createMockCtx() // 25% ≤ 50%
        await mockPi._handlers.get("agent_start")!({}, ctx)
        await new Promise((r) => setTimeout(r, 150))
        expect((ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)

        const callsBefore = (ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls.length
        await mockPi._handlers.get("agent_settled")!({ aborted: true }, ctx)
        expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)

        // The interval must be cleared, otherwise more frames would follow.
        await new Promise((r) => setTimeout(r, 150))
        expect((ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1)
    })
})

// ── Stale session context ────────────────────────────────
// After /new, /resume, /fork or /reload the old extension instance is
// invalidated: pi.getSessionName() and ctx.getContextUsage() throw. A throw
// inside the interval callback is fatal to pi, so both must be contained.

describe("stale session context", () => {
    let mockPi: ReturnType<typeof createMockPi>

    beforeEach(async () => {
        mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)
    })

    it("spinner tick survives a throwing getSessionName and stops", async () => {
        vi.useFakeTimers()
        try {
            const ctx = createMockCtx()
            await mockPi._handlers.get("agent_start")!({}, ctx)

            ;(mockPi.getSessionName as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error("This extension instance was replaced")
            })

            expect(() => vi.advanceTimersByTime(2000)).not.toThrow()

            const callsAfterStaleTick = (ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls.length
            vi.advanceTimersByTime(6000)
            expect((ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStaleTick)
        } finally {
            vi.useRealTimers()
        }
    })

    it("agent_start arms no interval when the first frame cannot be drawn", async () => {
        vi.useFakeTimers()
        try {
            const ctx = createMockCtx()
            ;(mockPi.getSessionName as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error("This extension instance was replaced")
            })

            await mockPi._handlers.get("agent_start")!({}, ctx)
            vi.advanceTimersByTime(10_000)

            // One attempt for the first frame and nothing after it: an armed interval
            // would retry the stale lookup on every tick.
            expect(mockPi.getSessionName).toHaveBeenCalledTimes(1)
            expect(ctx.ui.setTitle).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it("agent_settled survives a throwing getContextUsage and still shows idle", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => {
                throw new Error("This extension instance was replaced")
            },
        })
        await mockPi._handlers.get("agent_start")!({}, ctx)

        expect(() => mockPi._handlers.get("agent_settled")!({ aborted: false }, ctx)).not.toThrow()
        expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)
    })
})

// ── Done icon override ─────────────────────────────────

describe("idle icon override", () => {
    it("uses PI_STATUS_IDLE_ICON when set", async () => {
        const prev = process.env.PI_STATUS_IDLE_ICON
        process.env.PI_STATUS_IDLE_ICON = "🏁"
        vi.resetModules()
        try {
            const mod = await import("./pi-status.ts")
            const mockPi = createMockPi()
            mod.default(mockPi as unknown as ExtensionAPI)
            const ctx = createMockCtx() // 25% ≤ 50%
            const handler = mockPi._handlers.get("agent_settled")!
            await handler({ aborted: false }, ctx)
            expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} 🏁 ${EXPECTED_BASE_TITLE}`)
        } finally {
            if (prev === undefined) delete process.env.PI_STATUS_IDLE_ICON
            else process.env.PI_STATUS_IDLE_ICON = prev
            vi.resetModules()
        }
    })
})

// ── Context indicator ────────────────────────────────────

describe("context indicator", () => {
    // Code hides the indicator only for percent < 50 (docstring says ≤ 50).
    it("<50%: no indicator in title", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => ({
                percent: 49.9,
                tokens: 49_900,
                contextWindow: 100_000,
            }),
        })
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)

        const handler = mockPi._handlers.get("session_start")!
        handler({ reason: "startup" }, ctx)
        await new Promise((resolve) => setImmediate(resolve))
        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)
    })

    it(">50% and <90%: shows [N%] in title", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => ({
                percent: 63.7,
                tokens: 63_700,
                contextWindow: 100_000,
            }),
        })
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)

        const handler = mockPi._handlers.get("session_start")!
        handler({ reason: "startup" }, ctx)
        await new Promise((resolve) => setImmediate(resolve))
        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} [64%] ${EXPECTED_BASE_TITLE}`)
    })

    it("≥90%: shows ![N%]! in title", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => ({
                percent: 95,
                tokens: 95_000,
                contextWindow: 100_000,
            }),
        })
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)

        const handler = mockPi._handlers.get("session_start")!
        handler({ reason: "startup" }, ctx)
        await new Promise((resolve) => setImmediate(resolve))
        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} ![95%]! ${EXPECTED_BASE_TITLE}`)
    })

    it("context null: no indicator in title", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => undefined,
        })
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)

        const handler = mockPi._handlers.get("session_start")!
        handler({ reason: "startup" }, ctx)
        await new Promise((resolve) => setImmediate(resolve))
        expect(ctx.ui.setTitle).toHaveBeenCalledWith(`${AGENT_ICON} ${IDLE_ICON} ${EXPECTED_BASE_TITLE}`)
    })

    it("spinner on: context is not shown, even at ≥90%", async () => {
        const ctx = createMockCtx({
            getContextUsage: () => ({
                percent: 91,
                tokens: 91_000,
                contextWindow: 100_000,
            }),
        })
        const mockPi = createMockPi()
        const mod = await import("./pi-status.ts")
        mod.default(mockPi as unknown as ExtensionAPI)

        const handler = mockPi._handlers.get("agent_start")!
        await handler({}, ctx)
        await new Promise((r) => setTimeout(r, 150))

        const titleCalls = (ctx.ui.setTitle as ReturnType<typeof vi.fn>).mock.calls
        const allPlain = titleCalls.every((c: unknown[]) => SPINNER_FRAME_REGEX.test(c[0] as string))
        expect(allPlain).toBe(true)
    })
})
