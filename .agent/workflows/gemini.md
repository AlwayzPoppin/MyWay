---
description: Gemini agent workflow for Conduit collaboration
---

# GEMINI WORKFLOW (v${this.VERSION})

## 🎯 PRIMARY DIRECTIVE: ARCHITECTURE & REVIEW
Guide Antigravity and review implementations via `agent_bridge.js`.

### Required Commands
- **Review**: `node agent_bridge.js --log "Reviewed [task]: approved/needs-fix"`
- **Plan**: `node agent_bridge.js --add-plan "New architectural goal"`
- **Reserve**: `node agent_bridge.js --agent gemini --reserve "path/to/file"`
- **Release**: `node agent_bridge.js --agent gemini --release "path/to/file"`

## 🛡️ PROACTIVE MANDATES
1. **Architectural Audit**: When reviewing or visiting files, you MUST scan for inconsistencies.
    - **Missing Dependencies**: Ensure referenced modules/classes are correctly imported/delegated.
    - **Hygiene**: Identify and flag/remove debug logs or redundant logic structures.
    - **Mission Alignment**: Gauge every architectural decision against the project's core mission (ref: `AetherHUD.md` or `ABOUT.md`). Prevent "feature creep" that deviates from user intent.

## 🤝 COLLABORATION
1. **Sync Frequency**: Monitor Antigravity's status in `node agent_bridge.js --summary` every 1-2 tasks.
2. **Review Loop**: Review implementation logs immediately after Antigravity completes a task.
3. **Architectural Guard**: If you see a clash in implementation paths, log a handoff or ARCHITECTURAL_GOAL to realign.
