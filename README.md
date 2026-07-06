# 🎭 RPgraph Studio

> **Your personal roleplay engine — powered by your own AI, running entirely on your machine.**

![RPgraph Studio main screen](docs/main-screen.png)

🎬 **Demo video:** https://youtu.be/5QAYmLudR0M

RPGraph Studio is a **local-first desktop app** for interactive AI roleplay. Instead of a plain chatbox, you get a full studio: a **visual node workflow** decides how your story is built, a rich **RP chat** shows the results, and an in-world **phone messenger** lets your characters text each other — complete with images, events, and a living timeline.

No cloud account. No subscription. Your stories stay on **your** computer. 🔒

---

## ✨ Why RPgraph Studio?

- 🧩 **A pipeline, not a mono-prompt.** Classic RP engines pile everything into one prompt and run it top to bottom. RPgraph splits each turn into **several focused LLM calls**: translation, the actual response, then after-work like marking speakers, tracking story time, and preparing possible events.
- 🔀 **The right prompt for every moment.** A normal reply, a phone text, a narrator turn, an event — each situation can get its own prompt through the graph, automatically.
- 📱 **More than a chat window.** Characters can send phone messages that appear inline in the story, with contacts, replies, images, and full conversation history.
- 📖 **Story memory.** Storybooks hold your characters, world context, and images — including **SillyTavern character imports**. A built-in assistant helps you create, edit, and fine-tune your story data.
- 🎛️ **Mix and match models.** Every LLM node can use its **own connection**: let a small local model handle simple jobs like speaker marking, while a bigger API model writes the actual roleplay.
- 🏠 **Local & private.** Works with local LLMs (LM Studio, Ollama, any OpenAI-compatible API) and saves everything as files on your disk — optionally **encrypted**.

---

## 🚀 Features

### 🕸️ Visual Node Workflow
- Build your RP pipeline from nodes: user input, LLM prompts, story context, history, routing, output.
- **LLM Prompt Switch** nodes select different prompt variants automatically — normal RP, phone messages, AutoTurn, narrator turns, events — all through one graph.
- Live node colors show what's running, finished, prepared, or failed.

### 💬 Roleplay Chat
- Combined timeline where phone messages appear **inline** inside the roleplay.
- Character selection, narrator mode, drafts, image attachments, editing & regeneration.
- 🎨 **Spoken text highlighting**: the LLM detects who is speaking, and quoted dialogue is colored per character.
- ⏰ **In-world time tracking**: the LLM estimates passed time, time spans, and timeline labels.

### 📱 Phone Messenger
- A phone-style UI for character-to-character texting.
- Contacts, unread badges, replies, image messages, gallery, and per-character views.

### 📅 Events
- Schedule story events that can be **triggered, cancelled, or skipped** — and run straight through your workflow.

### 🌍 Translation Modes
- Translate only your input to English, **or** run the whole RP internally in English and translate the output back to your display language.

### 🤖 Built-in Assistant
- Press **`F1`** for help with your workflow — or select a node and press `F1` to ask about *that node* specifically.
- The assistant can inspect your graph, node states, and recent runs to help you debug.

### 🖼️ Image Generation (optional)
- Connect **ComfyUI** to generate character and story images right from the workflow.

### 💾 Saves & Files
- **RP Saves** bundle everything: workflow, storybook, and the full chat/session history — pick up exactly where you left off.
- Reusable **workflow files** and standalone **storybook files**.
- Save as plain JSON or as a **password/PIN-encrypted** file. 🔐

---

## 🏁 Getting Started

> 🧠 **Which model do I need?** RPGraph Studio was built and tuned around **Gemma 4 31B** — everything works with it out of the box. The workflows depend on reliable **JSON output**, and Gemma 4 is currently the smallest local model that can handle this. Smaller models won't cut it — if you can't run Gemma 4 locally, use a larger API model instead.

Install **[Git](https://git-scm.com/download/win)** and **[Node.js 24](https://nodejs.org/)**, then download RPGraph Studio:

```bash
git clone https://github.com/unrefined803/RPGraph.git
cd RPGraph
```

Launch the app:
- Linux: `RPGraph-linux.sh`
- Windows: `RPGraph-windows.bat`

If packages are missing, the starter will offer to install them.

---

## 📜 License

RPGraph Studio is free software, licensed under the **GNU AGPL v3.0 or later**. See [LICENSE](LICENSE).

---

## 🧪 Beta Notice

RPGraph Studio (v0.4.4 Beta) is a hobby project built with AI assistance. I am not a professional developer — bugs are expected, feedback is welcome! 💙
