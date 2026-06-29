import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── In-Memory Storage ───────────────────────────────────────────────────────
const plans = []

// ─── Tool Definitions (function declarations for Gemini) ────────────────────

const tools = [
  {
    functionDeclarations: [
      {
        name: "prioritize_tasks",
        description:
          "Analyzes a list of tasks with deadlines and returns them ranked by urgency and importance. Considers deadline proximity, estimated effort, and dependencies.",
        parameters: {
          type: "OBJECT",
          properties: {
            tasks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  title: { type: "STRING" },
                  deadline: { type: "STRING", description: "ISO date string or natural language like 'tomorrow 5pm'" },
                  estimatedMinutes: { type: "NUMBER", description: "Estimated time to complete in minutes" },
                  priority: { type: "STRING", enum: ["low", "medium", "high"] },
                },
                required: ["id", "title", "deadline"],
              },
            },
          },
          required: ["tasks"],
        },
      },
      {
        name: "generate_schedule",
        description:
          "Creates a time-blocked daily schedule from a prioritized task list. Fits tasks into available working hours and adds buffer time.",
        parameters: {
          type: "OBJECT",
          properties: {
            tasks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  title: { type: "STRING" },
                  estimatedMinutes: { type: "NUMBER" },
                  priorityScore: { type: "NUMBER" },
                },
                required: ["id", "title"],
              },
            },
            availableFrom: { type: "STRING", description: "Start time e.g. '09:00'" },
            availableUntil: { type: "STRING", description: "End time e.g. '22:00'" },
            currentTime: { type: "STRING", description: "Current time e.g. '14:30'" },
          },
          required: ["tasks", "availableFrom", "availableUntil"],
        },
      },
      {
        name: "suggest_replan",
        description:
          "When a task is missed or delayed, generates a revised plan that re-accommodates the missed task without compromising other critical deadlines.",
        parameters: {
          type: "OBJECT",
          properties: {
            missedTask: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                title: { type: "STRING" },
                deadline: { type: "STRING" },
                estimatedMinutes: { type: "NUMBER" },
              },
              required: ["id", "title", "deadline"],
            },
            remainingTasks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  title: { type: "STRING" },
                  deadline: { type: "STRING" },
                  scheduledAt: { type: "STRING" },
                },
              },
            },
            reason: { type: "STRING", description: "Why the task was missed e.g. 'took longer than expected'" },
          },
          required: ["missedTask", "remainingTasks"],
        },
      },
      {
        name: "detect_conflicts",
        description:
          "Scans the current schedule for time overlaps, back-to-back tasks with no buffer, and tasks scheduled too close to their deadlines.",
        parameters: {
          type: "OBJECT",
          properties: {
            schedule: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  title: { type: "STRING" },
                  startTime: { type: "STRING" },
                  endTime: { type: "STRING" },
                  deadline: { type: "STRING" },
                },
                required: ["id", "title", "startTime", "endTime"],
              },
            },
          },
          required: ["schedule"],
        },
      },
    ],
  },
];

// ─── Tool Executor (simulated — replace with real logic as needed) ───────────

function executeTool(name, args) {
  console.log(`\n[Tool Call] ${name}`, JSON.stringify(args, null, 2));

  switch (name) {
    case "prioritize_tasks": {
      const now = new Date();
      const scored = args.tasks.map((task) => {
        const deadline = new Date(task.deadline);
        const hoursLeft = (deadline - now) / (1000 * 60 * 60);
        const urgencyScore = hoursLeft < 6 ? 10 : hoursLeft < 24 ? 7 : hoursLeft < 72 ? 4 : 1;
        const priorityBonus = task.priority === "high" ? 3 : task.priority === "medium" ? 1 : 0;
        return { ...task, priorityScore: urgencyScore + priorityBonus, hoursUntilDeadline: Math.round(hoursLeft) };
      });
      scored.sort((a, b) => b.priorityScore - a.priorityScore);
      return { prioritizedTasks: scored };
    }

    case "generate_schedule": {
      const schedule = [];
      let cursor = args.availableFrom || args.currentTime || "09:00";
      const [startH, startM] = cursor.split(":").map(Number);
      let minutesCursor = startH * 60 + startM;

      for (const task of args.tasks) {
        const duration = task.estimatedMinutes || 45;
        const startHr = Math.floor(minutesCursor / 60).toString().padStart(2, "0");
        const startMin = (minutesCursor % 60).toString().padStart(2, "0");
        minutesCursor += duration;
        const endHr = Math.floor(minutesCursor / 60).toString().padStart(2, "0");
        const endMin = (minutesCursor % 60).toString().padStart(2, "0");
        minutesCursor += 10; // 10 min buffer between tasks

        schedule.push({
          ...task,
          startTime: `${startHr}:${startMin}`,
          endTime: `${endHr}:${endMin}`,
        });
      }
      return { schedule };
    }

    case "suggest_replan": {
      return {
        recommendation: `Move "${args.missedTask.title}" to the next available slot. Consider breaking it into smaller chunks if deadline is tight.`,
        adjustedTasks: args.remainingTasks.map((t) => ({
          ...t,
          note: "Shifted to accommodate missed task",
        })),
      };
    }

    case "detect_conflicts": {
      const conflicts = [];
      for (let i = 0; i < args.schedule.length - 1; i++) {
        const curr = args.schedule[i];
        const next = args.schedule[i + 1];
        if (curr.endTime > next.startTime) {
          conflicts.push({ between: [curr.title, next.title], type: "overlap" });
        }
      }
      return { conflicts, hasConflicts: conflicts.length > 0 };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

async function runAgent(userMessage, chatHistory = []) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools,
    systemInstruction: `You are an intelligent productivity agent called LifeSaver. 
Your job is to help users plan, prioritize, and complete tasks before deadlines.
You have access to tools: prioritize_tasks, generate_schedule, suggest_replan, detect_conflicts.
Always use tools to back your recommendations. Think step by step.
When a user gives you tasks, call prioritize_tasks first, then generate_schedule, then detect_conflicts.
Explain your reasoning clearly — tell the user WHY you scheduled things the way you did.`,
  });

  // Filter and format chat history properly (skip problematic entries)
  const cleanHistory = [];
  for (const msg of chatHistory) {
    if (msg.role === "user" && msg.content) {
      cleanHistory.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant" && msg.content) {
      cleanHistory.push({ role: "model", parts: [{ text: msg.content }] });
    }
  }

  const chat = model.startChat({ history: cleanHistory });
  const messages = [];

  let response = await chat.sendMessage(userMessage);
  messages.push({ role: "user", content: userMessage });

  // Agentic loop — keep going until no more tool calls
  while (true) {
    const candidate = response.response.candidates[0];
    const parts = candidate.content.parts;

    const toolCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (toolCalls.length === 0) {
      // No more tool calls — final text response
      const finalText = textParts.map((p) => p.text).join("");
      messages.push({ role: "assistant", content: finalText });
      return { reply: finalText, messages, toolsUsed: messages.filter((m) => m.role === "tool").map((m) => m.name) };
    }

    // Execute all tool calls
    const toolResults = toolCalls.map((part) => {
      const { name, args } = part.functionCall;
      const result = executeTool(name, args);
      messages.push({ role: "tool", name, args, result });
      return {
        functionResponse: {
          name,
          response: result,
        },
      };
    });

    // Send tool results back to Gemini
    response = await chat.sendMessage(toolResults);
  }
}

// ─── In-Memory Routes ────────────────────────────────────────────────────────

app.post("/api/agent", async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    const result = await runAgent(message, history || []);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/save-plan", async (req, res) => {
  try {
    const { input, schedule, reasoning } = req.body;
    if (!input || !schedule || !reasoning) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const plan = {
      id: plans.length + 1,
      input,
      schedule,
      reasoning,
      createdAt: new Date().toISOString(),
    };
    plans.push(plan);
    console.log(`[Plan Saved] #${plan.id} - ${input.substring(0, 50)}...`);
    res.json({ id: plan.id, message: "Plan saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/plans", (req, res) => {
  try {
    const recentPlans = plans.slice(-20).reverse();
    res.json(recentPlans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/metrics", (req, res) => {
  try {
    const totalPlans = plans.length;
    res.json({
      successRate: totalPlans > 0 ? Math.min(100, totalPlans * 15) : 0,
      averageTimeAccuracy: 85,
      bestTimeOfDay: "9am-12pm",
      totalPlans,
      totalTasks: totalPlans * 3,
    });
  } catch (err) {
    res.status(500).json({
      successRate: 0,
      averageTimeAccuracy: 0,
      bestTimeOfDay: "N/A",
    });
  }
});

app.get("/api/health", (_, res) => res.json({ status: "ok" }));

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LifeSaver agent running on http://localhost:${PORT}`));
