---
description: Antigravity agent workflow for Conduit collaboration
---

# ANTIGRAVITY WORKFLOW (v${this.VERSION})

## 🎯 PRIMARY DIRECTIVE: LOG YOUR WORK
You MUST log all work to `.conduit/context.json` using `agent_bridge.js`.

### Required Commands
- **Status**: `node agent_bridge.js --agent antigravity --status working --intent "Task description"`
- **Log**: `node agent_bridge.js --log "Detailed action taken"`
- **Plan**: `node agent_bridge.js --add-plan "Next step" --priority high`
- **Reserve**: `node agent_bridge.js --agent antigravity --reserve "path/to/file"`
- **Release**: `node agent_bridge.js --agent antigravity --release "path/to/file"`

## 🛡️ PROACTIVE MANDATES
1. **Deep Codebase Audit**: Whenever visiting a file, you MUST perform a proactive scan.
2.  **MVP AGENT: DO WHATEVER IT TAKES TO GET THE PRODUCT TO MVP STANDARDS
3.  **AUDIT: OCCASIONALLY PERFORM AN AUDIT AND DETECT MISSING GAPS IN DEVELOPMENT OF PROJECT
4.  **PROACTIVE AGENT: BE PROACTIVE BY MAKING SUGGESTIONS, AND PUSHING TO GITHUB AFTER EVERY MAJOR UPDATE.
5.VERIFICATION: MUST GET VISUAL VERIFCATION OF VIUSAL UPDATES OR FIXES.
    - **Missing Imports**: Check for referenced variables/types that aren't imported (crucial after refactors).
    - **Debug Cleanup**: Locate and remove/flag `console.log`, `print`, or debug comments.
    - **Safety & Hygiene**: Identify race conditions, unhandled errors, or dead code (unused variables).
    - **Silent Cleanup**: Fix minor issues (typos, spacing, logs) without asking. Log these via `--log`.
2. **Mission Alignment**: Gauge the overall project mission (ref: `AetherHUD.md` or `ABOUT.md`) before proposing features. Only suggest improvements that align with the user's core intent.

## 🤝 COLLABORATION
1. **Sync Frequency**: Check `node agent_bridge.js --summary` every 1-2 tasks.
2. **Conflict Prevention**: Before editing a file, check if a peer agent has a pending plan or active intent for it.
3. **Log Visibility**: IMMEDIATELY log actions so peers are aware of your changes.
4. **File Ownership**: MANDATORY: Reserve a file before editing (`--reserve`) and release (`--release`) immediately after completion.