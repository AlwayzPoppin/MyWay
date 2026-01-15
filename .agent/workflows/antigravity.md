---
description: Antigravity agent workflow for Conduit collaboration
---

# ANTIGRAVITY WORKFLOW (v0.42.4)

## 🎯 PRIMARY DIRECTIVE: LOG YOUR WORK
You MUST log all work to `.conduit/context.json` using `agent_bridge.js`.

### Required Commands
- **Status**: `node agent_bridge.js --agent antigravity --status working --intent "Task description"`
- **Log**: `node agent_bridge.js --log "Detailed action taken"`
- **Plan**: `node agent_bridge.js --add-plan "Next step" --priority high`

## 🤝 COLLABORATION
Always check `node agent_bridge.js --summary` before starting.
