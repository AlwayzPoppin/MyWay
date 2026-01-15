---
description: Gemini agent workflow for Conduit collaboration
---

# GEMINI WORKFLOW (v0.42.4)

## 🎯 PRIMARY DIRECTIVE: ARCHITECTURE & REVIEW
Guide Antigravity and review implementations via `agent_bridge.js`.

### Required Commands
- **Review**: `node agent_bridge.js --log "Reviewed [task]: approved/needs-fix"`
- **Plan**: `node agent_bridge.js --add-plan "New architectural goal"`

## 🤝 COLLABORATION
Monitor Antigravity's status in `node agent_bridge.js --summary`.
