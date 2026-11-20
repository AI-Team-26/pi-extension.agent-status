/**
 * Pi Status Extension
 *
 * Shows a idle icon (✔️ as default) in the **terminal title** when pi is idle (session finished, waiting for user input). 
 * When the user submits a prompt, the idle icon is replaced by a braille-dot spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏).
 *
 * Context-usage percentage appears beside the checkmark (idle state) in the title:
 *   ≤ 50%  → not shown
 *   > 50%  → [N%]   (e.g. ✔️ [63%] project)
 *   ≥ 90%  → ![N%]!  (e.g. ✔️ ![95%]! project)
 * The percentage is captured once when the checkmark is shown; the spinner never displays it.
 *
 * Usage:
 *   pi -e ./pi-status.ts
 *   # Or place in ~/.pi/agent/extensions/pi-status.ts for auto-discovery
 */

import path from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const AGENT_ICON = process.env.PI_STATUS_AGENT_ICON || "π"
const IDLE_ICON = process.env.PI_STATUS_IDLE_ICON || "✔️"

const DEBUG = process.env.PI_STATUS_DEBUG === "1"
function log(msg: string) {
    if (DEBUG) console.error(`[pi-status] ${msg}`)
}

function getBaseTitle(pi: ExtensionAPI): string {
    const cwd = path.basename(process.cwd())
    const session = pi.getSessionName()
    return session ? `${session} - ${cwd}` : `${cwd}`
}

function getContextIndicator(ctx: ExtensionContext): string {
    const usage = ctx.getContextUsage()
    const percent = usage?.percent ?? 0
    if (percent < 50) return ""
    const pct = Math.round(percent)
    const formatted = `[${pct}%]`
    return ` ${percent >= 90 ? `!${formatted}!` : formatted}`
}

export default function (pi: ExtensionAPI) {
    let timer: ReturnType<typeof setInterval> | null = null
    let frameIndex = 0
    // The spinner interval runs outside a handler, so it needs the latest context.
    let currentCtx: ExtensionContext | null = null

    // A throwing setTitle inside the interval callback would kill the timer and freeze the title.
    function safeSetTitle(ctx: ExtensionContext, title: string) {
        try {
            ctx.ui.setTitle(`${AGENT_ICON} ${title}`)
        } catch (err) {
            console.error("[pi-status] setTitle failed:", err)
        }
    }

    function stopSpinner() {
        if (timer) {
            clearInterval(timer)
            timer = null
            log("spinner stopped")
        }
        frameIndex = 0
    }

    function restoreTitle(ctx: ExtensionContext) {
        log("restoring idle title")
        let indicator = ""
        try {
            indicator = getContextIndicator(ctx)
        } catch (err) {
            // Context usage comes from live session state, which throws once the instance is stale.
            log(`context indicator unavailable: ${err}`)
        }
        let base: string
        try {
            base = getBaseTitle(pi)
        } catch (err) {
            log(`base title unavailable: ${err}`)
            return
        }
        safeSetTitle(ctx, `${IDLE_ICON}${indicator} ${base}`)
    }

    /** Draws one spinner frame. Returns false when the spinner gave up and must not be armed. */
    function showSpinnerFrame(): boolean {
        const ctx = currentCtx
        if (!ctx) {
            stopSpinner()
            return false
        }
        let base: string
        try {
            base = getBaseTitle(pi)
        } catch (err) {
            // A throw inside the interval callback is fatal to pi, and a stale instance
            // can never produce a valid title again, so stop instead of retrying.
            log(`spinner frame skipped: ${err}`)
            stopSpinner()
            return false
        }
        safeSetTitle(ctx, `${SPINNER_FRAMES[frameIndex]} ${base}`)
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
        return true
    }

    function startSpinner(ctx: ExtensionContext) {
        currentCtx = ctx
        if (timer) return
        if (!showSpinnerFrame()) return
        timer = setInterval(() => {
            showSpinnerFrame()
        }, 2000)
        ;(timer as any).unref?.()
        log("spinner started")
    }

    pi.on("session_start", (_e, ctx) => {
        stopSpinner() // clear any interval left over from a previous session
        currentCtx = ctx
        // Defer to let pi's init-based updateTerminalTitle() fire first
        setImmediate(() => restoreTitle(ctx))
    })

    pi.on("agent_start", (_e, ctx) => {
        startSpinner(ctx)
    })

    pi.on("agent_settled", (_e, ctx) => {
        currentCtx = ctx
        stopSpinner()
        restoreTitle(ctx)
    })
}
