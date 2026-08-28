---
description: 
---

# 🌌 **Stellar Engine — Antigravity Workflow (AAA 3D Engine Edition)**  
### *Minimal, stable, visual-first development with controlled proactivity*

---

## **0) Protected Systems**
- **Do not modify** `known-good-systems.md` or `stellar-reference-code.md` unless *you* have personally verified the change in the viewport.

---

## **1) Clarify the Task Before Coding**
- Identify whether the request affects: Rendering, Physics, Animation, Materials, Camera, Input, or Scene Graph.  
- Understand the expected **visual + technical behavior** before touching code.  
- If anything is unclear, investigate context instead of guessing.

**Rule:** No code until the behavior is understood.

---

## **2) Verify the Engine Environment**
- Dev server running  
- Scene loads with **zero warnings**  
- GPU backend active  
- Shaders compiled  
- Scene graph + physics world initialized  

If anything is off, restart and recompile.

---

## **3) Make Small, Controlled Changes**
- Edit only the intended subsystem  
- Avoid touching shared systems unless required  
- After each micro‑change:  
  - Save  
  - Let compiler validate  
  - Watch for warnings  
  - Rebuild shaders if needed  

If a change spans multiple subsystems, break it into smaller steps.

---

## **4) Immediate Visual Verification**
- Reload the scene  
- Inspect lighting, shadows, reflections  
- Move the camera around the affected object  
- Confirm no other systems broke  

If the scene “feels wrong,” treat it as a real issue.

---

## **5) Test the Player Object**
- Focus player  
- Move, rotate, jump, collide  
- Validate:  
  - Grounding  
  - Collisions  
  - Animation blending  
  - Materials  
  - Camera follow behavior  

If the player breaks, the engine breaks.

---

## **6) Test Like a Human**
- Move naturally through the world  
- Try odd interactions  
- Look for jitter, popping, lag, lighting inconsistencies  

Human intuition catches what logs miss.

---

## **7) Run a 3D Regression Sweep**
Check all major systems:

**Rendering:** shadows, reflections, post‑processing  
**Physics:** collisions, rigidbodies, constraints  
**Animation:** transitions, IK, blend trees  
**Scene Graph:** transforms, LOD, culling  
**Performance:** frame pacing, GPU/CPU spikes  
**Console:** zero errors, zero warnings  

Regression sweeps prevent slow engine decay.

---

## **8) Finalize & Stabilize**
- Remove unused code/logs  
- Fix lint issues  
- Ensure clean console  
- Confirm scene loads with no shader warnings  
- Commit only when stable  
- Document what changed and why  

---

## **9) Maintain the Known‑Good Systems Log**
- `known-good-systems.md` lists subsystems verified as stable  
- Avoid editing stable systems unless required  
- If a subsystem breaks, remove it from the log until re‑verified  

This prevents accidental regressions.

---

## **10) Maintain the Golden Reference Code**
- `stellar-reference-code.md` stores verified, copy‑pasteable core logic  
- Update only after viewport‑verified success  
- Use it for A/B debugging or restoring stability  

This is your baseline truth for engine behavior.

---

# 🌠 **Workflow Summary**
1. Understand expected behavior  
2. Start from a clean environment  
3. Make controlled, isolated changes  
4. Visually verify every update  
5. Test the player object  
6. Use human “feel” testing  
7. Run a full regression sweep  
8. Clean and stabilize  
9. Update known‑good systems  
10. Maintain reference code  

---

# 🌟 **Proactive Development Rule (New)**  
The AI may proactively suggest improvements **only when**:

- They directly support your stated goals  
- They reduce future bugs or technical debt  
- They do not expand scope beyond MVP  
- They are small, safe, and easy to verify visually  

If a suggestion risks scope creep, the AI must flag it instead of pushing it.

---
