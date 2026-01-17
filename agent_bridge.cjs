const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Conduit Agent Bridge
 * Allows agents to update status and queue commands safely.
 */

const CONDUIT_DIR = path.join(__dirname, '.conduit');
const CONTEXT_PATH = path.join(CONDUIT_DIR, 'context.json');
const COMMANDS_PATH = path.join(CONDUIT_DIR, 'commands.json');
const MEMORY_PATH = path.join(CONDUIT_DIR, 'memory.json');
const HISTORY_PATH = path.join(CONDUIT_DIR, 'history.json');
const RESULTS_PATH = path.join(CONDUIT_DIR, 'results.json');
const LOCK_PATH = path.join(CONDUIT_DIR, 'lock');

const MAX_BACKUPS = 5;
const getBakPath = (i) => `${CONTEXT_PATH}.${i}`;

// Simple arg parser (no external deps)
function parseArgs(argv) {
    const args = { shadow: false, archive: false, bootstrap: false, clear: false, timeline: false, clearHistory: false, retry: false, unignore: false, sweep: false, cleanBackups: false, approve: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2).replace(/-([a-z])/g, g => g[1].toUpperCase());
            if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
                args[key] = argv[i + 1];
                i++;
            } else {
                args[key] = true;
            }
        }
    }
    if (args.approval) args.approval = args.approval === 'true';
    return args;
}

const args = parseArgs(process.argv.slice(2));

async function acquireLock() {
    const start = Date.now();
    const timeout = 10000; // 10 second total timeout

    while (Date.now() - start < timeout) {
        try {
            // 'wx' flag fails if file exists, ensuring atomicity
            const handle = await fsPromises.open(LOCK_PATH, 'wx');
            await handle.writeFile(process.pid.toString());
            await handle.close();
            return;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;

            try {
                const stats = await fsPromises.stat(LOCK_PATH);
                const lockAge = Date.now() - stats.mtimeMs;
                if (lockAge > 5000) {
                    await fsPromises.unlink(LOCK_PATH).catch(() => { });
                    continue;
                }
            } catch (statErr) {
                // If file was deleted between catch and stat, just retry
                continue;
            }

            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
        }
    }
    throw new Error('Timeout acquiring lock');
}

async function updateState() {
    if (!fs.existsSync(CONDUIT_DIR)) {
        fs.mkdirSync(CONDUIT_DIR, { recursive: true });
    }

    await acquireLock();

    /**
     * Self-Repair: Migrates old context schemas to the current version.
     */
    const migrateContext = (ctx) => {
        const currentVersion = "0.42.4";
        let changed = false;
        if (ctx.version !== currentVersion) {
            console.log(`🔧 Migrating context from ${ctx.version || 'legacy'} to ${currentVersion}...`);
            ctx.version = currentVersion;
            ctx.preferences = { ...{ sync: true, hideDone: false, autoRefresh: true, audioAlerts: true, hideDonePlans: false }, ...(ctx.preferences || {}) };
            ctx.agentIntents = ctx.agentIntents || {};
            ctx.plans = ctx.plans || [];
            // Convert legacy array-based intents to object-based
            if (Array.isArray(ctx.agentIntents)) {
                const newIntents = {};
                ctx.agentIntents.forEach(i => {
                    if (i.agent) newIntents[i.agent.toLowerCase()] = { intent: i.intent, status: i.status, lastUpdate: new Date().toISOString() };
                });
                ctx.agentIntents = newIntents;
            }
            changed = true;
        }
        return { ctx, changed };
    };

    const atomicWrite = (filePath, data) => {
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        try {
            fs.renameSync(tempPath, filePath);
        } catch (e) {
            try {
                fs.copyFileSync(tempPath, filePath);
            } catch (copyErr) {
                console.error(`❌ Atomic write failed: ${copyErr.message}`);
            } finally {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }
        }
    };

    const logToHistory = (msg) => {
        let history = [];
        if (fs.existsSync(HISTORY_PATH)) {
            try {
                history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
            } catch (e) { history = []; }
        }
        history.push({
            timestamp: new Date().toISOString(),
            agent: args.agent || 'system',
            event: msg
        });
        if (history.length > 500) history = history.slice(-500);
        atomicWrite(HISTORY_PATH, history);
    };

    const saveContext = (ctx) => {
        if (fs.existsSync(HISTORY_PATH)) {
            try {
                const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
                const recent = history.slice(-15);
                ctx.recentEvents = recent.map(h => {
                    const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                    return `[${time}] ${h.agent}: ${h.event}`;
                }).join('\n');
            } catch (e) { ctx.recentEvents = "History unavailable."; }
        }
        if (fs.existsSync(COMMANDS_PATH)) {
            try {
                const commands = JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8'));
                ctx.pendingCommands = Array.isArray(commands) ? commands.filter(c => c.status === 'pending') : [];
            } catch (e) { ctx.pendingCommands = []; }
        }
        if (fs.existsSync(RESULTS_PATH)) {
            try {
                const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
                ctx.latestResults = Array.isArray(results) ? results.slice(-5) : [];
            } catch (e) { ctx.latestResults = []; }
        }
        atomicWrite(CONTEXT_PATH, ctx);
    };

    try {
        if (args.clear) {
            const filesToClear = ['context.json', 'commands.json', 'results.json', 'snapshot.json', 'history.json'];
            filesToClear.forEach(file => {
                const filePath = path.join(CONDUIT_DIR, file);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
            for (let i = 1; i <= MAX_BACKUPS; i++) {
                const bak = getBakPath(i);
                if (fs.existsSync(bak)) fs.unlinkSync(bak);
            }
            console.log("🧹 All Conduit documents and state cleared.");
            return;
        }

        if (args.clearHistory) {
            if (fs.existsSync(HISTORY_PATH)) fs.unlinkSync(HISTORY_PATH);
            console.log("🗑️ Conduit history cleared.");
            logToHistory("SYSTEM: History cleared by request.");
            return;
        }

        if (args.approve) {
            if (fs.existsSync(COMMANDS_PATH)) {
                try {
                    let commands = JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8'));
                    const cmd = commands.find(c => c.id === args.approve);
                    if (cmd) {
                        cmd.requiresApproval = false;
                        atomicWrite(COMMANDS_PATH, commands);
                        console.log(`✅ Approved command: ${cmd.id}`);
                        logToHistory(`APPROVED: Command ${cmd.id} [${cmd.action}]`);
                    }
                } catch (e) { }
            }
            return;
        }

        if (args.sweep) {
            console.log("🧹 Performing Automated Workspace Sweep...");
            if (fs.existsSync(CONTEXT_PATH)) {
                let context = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
                const donePlans = (context.plans || []).filter(p => p.status === 'done');
                if (donePlans.length > 0) {
                    donePlans.forEach(p => logToHistory({ type: 'ARCHIVE', planId: p.id, contribution: p.task }));
                    context.plans = context.plans.filter(p => p.status !== 'done');
                    saveContext(context);
                    console.log(`  📦 Archived ${donePlans.length} plans.`);
                }
            }
            const ttFiles = fs.readdirSync(CONDUIT_DIR);
            ttFiles.filter(f => f.endsWith('.tmp')).forEach(f => {
                try { fs.unlinkSync(path.join(CONDUIT_DIR, f)); } catch (e) { }
            });
            const gitignorePath = path.join(CONDUIT_DIR, '..', '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                let content = fs.readFileSync(gitignorePath, 'utf8');
                const filtered = content.split(/\r?\n/).filter(line => !line.includes('.conduit') && !line.includes('.agent'));
                fs.writeFileSync(gitignorePath, filtered.join('\n').trim() + '\n');
            }
            logToHistory("SYSTEM: Automated sweep completed.");
            return;
        }

        if (args.unignore) {
            console.log("🔓 Restoring workspace visibility for .conduit and .agent...");
            const gitignorePath = path.join(CONDUIT_DIR, '..', '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                let content = fs.readFileSync(gitignorePath, 'utf8');
                const lines = content.split(/\r?\n/);
                const filtered = lines.filter(line => !line.trim().startsWith('.conduit') && !line.trim().startsWith('.agent'));

                fs.writeFileSync(gitignorePath, filtered.join('\n').trim() + '\n');
                console.log("✅ Updated .gitignore: Removed .conduit and .agent from ignore list.");
                logToHistory("SYSTEM: Workspace visibility restored (unignored .conduit and .agent).");
            }
            return;
        }

        if (args.timeline) {
            if (fs.existsSync(HISTORY_PATH)) {
                try {
                    const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
                    console.log("\n--- 🛤️ Conduit Orchestration Timeline ---");
                    const recent = history.slice(-20);
                    recent.forEach((entry, i) => {
                        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const prefix = i === recent.length - 1 ? "┗" : "┣";
                        const eventMsg = typeof entry.event === 'object' ? `ARCHIVE: ${entry.event.task}` : entry.event;
                        console.log(`${prefix}━ [${time}] ${entry.agent.toUpperCase().padEnd(12)}: ${eventMsg}`);
                    });
                    console.log("-----------------------------\n");
                } catch (e) { }
            }
            return;
        }

        if (args.learn) {
            let memory = { learnings: [], preferences: {}, projectRules: [], lastUpdated: new Date().toISOString() };
            if (fs.existsSync(MEMORY_PATH)) {
                try { memory = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')); } catch (e) { }
            }
            memory.learnings.push({
                content: args.learn,
                timestamp: new Date().toISOString(),
                source: args.agent || 'bridge'
            });
            if (memory.learnings.length > 100) memory.learnings = memory.learnings.slice(-100);
            memory.lastUpdated = new Date().toISOString();
            atomicWrite(MEMORY_PATH, memory);
            console.log(`🧠 Conduit: Indexed architectural insight - "${args.learn}"`);
            return;
        }

        if (args.addPlan) {
            let context = {};
            if (fs.existsSync(CONTEXT_PATH)) {
                try { context = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8')); } catch (e) { }
            }
            context.plans = context.plans || [];
            context.plans.push({
                task: args.addPlan,
                status: 'pending',
                priority: args.priority || 'medium',
                dependsOn: args.dependsOn || null,
                assignee: args.agent || 'antigravity',
                id: crypto.randomBytes(4).toString('hex'),
                timestamp: new Date().toISOString()
            });
            logToHistory(`PLAN ADDED: "${args.addPlan}" (ID: ${context.plans[context.plans.length - 1].id})`);
            saveContext(context);
            console.log(`📋 Added Plan: ${args.addPlan}`);
            return;
        }

        if (args.log) {
            let context = {};
            if (fs.existsSync(CONTEXT_PATH)) {
                try { context = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8')); } catch (e) { }
            }
            context.contributions = context.contributions || [];
            context.contributions.push({
                type: 'contribution',
                agent: args.agent || 'antigravity',
                action: args.log,
                files: [],
                timestamp: new Date().toISOString()
            });
            if (context.contributions.length > 100) context.contributions = context.contributions.slice(-100);
            logToHistory(`CONDUIT: [${args.agent || 'antigravity'}] ${args.log}`);
            saveContext(context);
            console.log(`📝 Logged Contribution: ${args.log}`);
            return;
        }

        if (args.bootstrap || (args.agent && (args.status || args.intent))) {
            // Ensure .conduit and .agent are visible to agents on startup
            const gitignorePath = path.join(CONDUIT_DIR, '..', '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                let content = fs.readFileSync(gitignorePath, 'utf8');
                const lines = content.split(/\r?\n/);
                const filtered = lines.filter(line => !line.trim().startsWith('.conduit') && !line.trim().startsWith('.agent'));
                if (filtered.length !== lines.length) fs.writeFileSync(gitignorePath, filtered.join('\n').trim() + '\n');
            }

            // Verify Workflow Accessibility
            const workflowDir = path.join(CONDUIT_DIR, '..', '.agent', 'workflows');
            ['antigravity', 'gemini'].forEach(agent => {
                const wfPath = path.join(workflowDir, `${agent}.md`);
                if (fs.existsSync(wfPath)) {
                    if (args.bootstrap) console.log(`📖 Workflow verified for ${agent}: ${path.basename(wfPath)}`);
                } else {
                    console.warn(`⚠️ Warning: Workflow file missing for ${agent} at ${wfPath}`);
                }
            });

            let context = {
                session: { id: crypto.randomBytes(16).toString('hex'), started: new Date().toISOString() },
                version: "0.42.4",
                agentIntents: {},
                lastSync: new Date().toISOString(),
                contributions: [],
                handoffs: [],
                plans: [],
                activeFiles: [],
                currentTask: "Initializing workspace...",
                preferences: { sync: true, hideDone: false, autoRefresh: true, audioAlerts: true, hideDonePlans: false }
            };

            if (fs.existsSync(CONTEXT_PATH)) {
                try {
                    context = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
                    const { ctx, changed } = migrateContext(context);
                    context = ctx;
                } catch (e) { }
            }

            if (args.agent) {
                let status = args.status || context.agentIntents[args.agent]?.status || 'idle';
                let intent = args.intent || context.agentIntents[args.agent]?.intent || '';

                context.agentIntents[args.agent] = {
                    ...(context.agentIntents[args.agent] || {}),
                    status: status,
                    intent: intent,
                    lastUpdate: new Date().toISOString()
                };

                logToHistory(`AGENT UPDATE: ${args.agent} [${status}] intent: "${intent}"`);
            }

            context.lastSync = new Date().toISOString();
            saveContext(context);
            console.log(`✅ Updated Conduit: session="${context.session.id.slice(0, 8)}"`);
        }

        if (args.command) {
            let commands = [];
            if (fs.existsSync(COMMANDS_PATH)) {
                try { commands = JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8')); } catch (e) { }
            }

            const newCommand = {
                id: crypto.randomBytes(4).toString('hex'),
                action: args.command,
                args: [],
                status: 'pending',
                issuer: args.agent || 'unknown',
                requiresApproval: args.approval || false,
                createdAt: new Date().toISOString(),
                ttl: 300,
                timestamp: new Date().toISOString()
            };

            commands.push(newCommand);
            atomicWrite(COMMANDS_PATH, commands);
            console.log(`📋 Queued command: ${args.command}`);
        }

        if (args.summary) {
            if (fs.existsSync(CONTEXT_PATH)) {
                const context = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
                console.log("\n--- Conduit Orchestration Hub ---");
                console.log(`Session:      ${context.session.id.slice(0, 8)}`);
                console.log(`Current Task: ${context.currentTask}`);
                console.log("Agent Health:");
                Object.entries(context.agentIntents || {}).forEach(([agent, data]) => {
                    console.log(`  - ${agent.toUpperCase().padEnd(12)}: [${data.status.padEnd(7)}] ${data.intent}`);
                });
                console.log("---------------------------------\n");
            }
        }

    } finally {
        if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
    }
}

updateState().catch(err => {
    console.error(`❌ Conduit Error: ${err.message}`);
    process.exit(1);
});
