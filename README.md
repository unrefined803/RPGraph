# 🎭 RPgraph Studio

> **Your personal roleplay engine — powered by your own AI, running entirely on your machine.**

![RPgraph Studio main screen](docs/main-screen.png)

🎬 **Demo video:** https://youtu.be/nweut7o-qnA

RPGraph Studio is a **local-first desktop app** for interactive AI roleplay. Instead of a plain chatbox, you get a full studio: a **visual node workflow** decides how your story is built, a rich **RP chat** shows the results, and an in-world **character phone** with its own apps brings the story world to life.

No cloud account. No subscription. Your stories stay on **your** computer. 🔒

---

## ✨ Why RPgraph Studio?

- 🧩 **A pipeline, not a mono-prompt.** Each turn is split into **several focused LLM calls**: translation, the actual response, then after-work like speaker marking, story-time tracking, and event preparation.
- 🔀 **The right prompt for every moment.** Normal reply, phone text, narrator turn, social post, event — each situation gets its own prompt through the graph, automatically.
- 📱 **A phone full of apps.** Characters text, post, and bank on an in-world phone whose messages appear inline in the story.
- 📖 **Story memory.** Storybooks hold characters, world context, and images — including **SillyTavern character imports** — with a built-in assistant to create and edit them.
- 🎛️ **Mix and match models.** Every LLM node can use its **own connection**: a small local model for simple jobs, a bigger model for the actual roleplay.
- 🏠 **Local & private.** Connects to LM Studio, Ollama, llama.cpp (router mode), OpenRouter, or Google Gemini. Optional ComfyUI connections add image and voice generation. Everything is saved as files on your disk — optionally **encrypted**.

---

## 🚀 Features

### 🕸️ Visual Node Workflow
- Build your RP pipeline from nodes: user input, LLM prompts, story context, history, routing, output.
- **LLM Prompt Switch** nodes pick the matching prompt variant automatically — normal RP, phone, social media, AutoTurn, narrator, events, Autoplay.
- Live node colors show what's running, finished, prepared, or failed.

### 💬 Roleplay Chat
- Combined timeline where phone and app messages appear **inline** inside the roleplay.
- Character selection, narrator mode, drafts, image attachments, editing & regeneration.
- 🎨 **Spoken text highlighting**: quoted dialogue is colored per character.
- ⏰ **In-world time tracking**: the LLM estimates passed time and timeline labels.
- 🔊 **Voice playback** (optional): cloned character voices and a narrator can read the story aloud.

### 📱 Character Phone
A phone-style UI owned by your characters, with its own apps:
- **WhatsUp** — messenger with contacts, unread badges, replies, images, and voice messages.
- **Fotogram & OnlyFriends** — social media with posts, comments, likes, and DMs.
- **Camera & Gallery** — character photos, uploads, and generated images.
- **Banking** — accounts, balances, statements, and transfers.
- **Notes** — editable character note cards.

### 📅 Events
- Schedule story events that can be **triggered, cancelled, or skipped** — and run straight through your workflow.

### 🌍 Translation Modes
- Translate only your input to English, **or** run the whole RP internally in English and translate the output back to your display language.

### 🤖 Built-in Assistant
- Press **`F1`** for help with your workflow — or select a node and press `F1` to ask about *that node*.
- The assistant can inspect your graph, node states, and recent runs to help you debug.

### 🖼️ Image & Voice Generation (optional)
- Connect **ComfyUI** to generate character images and voice clips right from the workflow.
- RPGraph swaps between your LLM and the ComfyUI image/voice models **automatically** within seconds — one GPU is enough.

### 💾 Saves & Files
- **RP Saves** bundle everything: workflow, storybook, and full chat history — pick up exactly where you left off.
- Reusable **workflow files**, standalone **storybooks**, and exportable **character cards**.
- Save as plain JSON or as a **password/PIN-encrypted** file. 🔐

---

## 🏁 Getting Started

> 🧠 **Which model do I need?** Recommended: **[gemma-4-31B-it-uncensored-heretic-GGUF](https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF)**. RPGraph was built and tuned around Gemma 4 31B; the workflows depend on reliable **JSON output**, and Gemma 4 is currently the smallest local model that handles this well. I don't recommend RP finetunes — many of them struggle with the JSON parts of the pipeline. If you can't run Gemma 4 locally, use a larger API model instead.

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

RPGraph Studio (v0.4.9 Beta) is a hobby project built with AI assistance. I am not a professional developer — bugs are expected, feedback is welcome! 💙
