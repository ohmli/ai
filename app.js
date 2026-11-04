import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";
import { renderMarkdown } from "./markdown.js";

const $ = (id) => document.getElementById(id);

// Browser storage can be unavailable, so every access is guarded.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

const el = {
  setup: $("setup"), loading: $("loading"), chat: $("chat"),
  noGpu: $("noGpu"), setupForm: $("setupForm"),
  modelSelect: $("modelSelect"), systemInput: $("systemInput"), loadBtn: $("loadBtn"),
  bar: $("bar"), loadStatus: $("loadStatus"), loadTitle: $("loadTitle"),
  thread: $("thread"), hello: $("hello"), scroller: $("scroller"),
  input: $("input"), sendBtn: $("sendBtn"),
  badge: $("badge"), newBtn: $("newBtn"), changeBtn: $("changeBtn")
};

const DEFAULT_SYSTEM = "You are a helpful, friendly assistant. Keep answers clear and concise.";
const MAX_HISTORY = 12; // messages sent to the model each turn (keeps within its context window)

// Models to preselect, in order of preference (first one available wins).
const PREFERRED = [
  /Llama-3\.2-1B-Instruct-q4f16/,
  /Llama-3\.2-1B-Instruct-q4f32/,
  /Qwen2\.5-1\.5B-Instruct-q4f16/,
  /Qwen2\.5-1\.5B-Instruct-q4f32/,
  /SmolLM2-360M-Instruct/
];

let engine = null;
let history = [];
let generating = false;
let system = DEFAULT_SYSTEM;

// ---------- views ----------
function show(view) {
  el.setup.hidden = view !== "setup";
  el.loading.hidden = view !== "loading";
  el.chat.hidden = view !== "chat";
  const inChat = view === "chat";
  el.badge.hidden = !inChat;
  el.newBtn.hidden = !inChat;
  el.changeBtn.hidden = !inChat;
  if (inChat) el.input.focus();
}

// ---------- model list ----------
async function supportsF16() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter && adapter.features.has("shader-f16");
  } catch (e) { return false; }
}

function buildModelList(f16) {
  return webllm.prebuiltAppConfig.model_list
    .filter((m) => (m.model_type ?? 0) === 0)                       // chat models only
    .filter((m) => m.vram_required_MB && m.vram_required_MB <= 6000) // keep it laptop-friendly
    .filter((m) => f16 || (!/f16/.test(m.model_id) && !(m.required_features || []).includes("shader-f16")))
    .sort((a, b) => a.vram_required_MB - b.vram_required_MB);
}

function fillModelSelect(models) {
  el.modelSelect.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    const gb = (m.vram_required_MB / 1024).toFixed(1);
    opt.value = m.model_id;
    opt.textContent = m.model_id.replace(/-MLC$/, "") + " (needs about " + gb + " GB of GPU memory)";
    el.modelSelect.appendChild(opt);
  }
  const saved = store.get("ai.model", "");
  let pick = models.find((m) => m.model_id === saved);
  for (let i = 0; !pick && i < PREFERRED.length; i++) {
    pick = models.find((m) => PREFERRED[i].test(m.model_id));
  }
  el.modelSelect.value = (pick || models[0]).model_id;
}

// ---------- loading the model ----------
async function loadModel() {
  const id = el.modelSelect.value;
  system = el.systemInput.value.trim() || DEFAULT_SYSTEM;
  store.set("ai.model", id);
  store.set("ai.system", el.systemInput.value);

  el.loadTitle.textContent = "Loading " + id.replace(/-MLC$/, "");
  el.bar.value = 0;
  el.loadStatus.textContent = "Starting";
  show("loading");

  const onProgress = (report) => {
    el.bar.value = report.progress || 0;
    el.loadStatus.textContent = report.text || "";
  };

  try {
    if (!engine) {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: onProgress });
    } else {
      engine.setInitProgressCallback(onProgress);
      await engine.reload(id);
    }
    history = [];
    el.thread.innerHTML = "";
    el.hello.hidden = false;
    show("chat");
  } catch (err) {
    show("setup");
    showSetupError("Couldn't load that model: " + (err && err.message ? err.message : err) +
      " Try a smaller model, or check that your device has enough GPU memory.");
  }
}

function showSetupError(text) {
  el.noGpu.textContent = text;
  el.noGpu.hidden = false;
}

// ---------- chat ----------
function addMsg(kind, text) {
  el.hello.hidden = true;
  const m = document.createElement("div");
  if (kind === "user") { m.className = "msg user"; m.textContent = text; }
  else if (kind === "error") { m.className = "msg bot error"; m.textContent = text; }
  else { m.className = "msg bot"; m.innerHTML = renderMarkdown(text); }
  el.thread.appendChild(m);
  scrollDown();
  return m;
}
function scrollDown() { el.scroller.scrollTop = el.scroller.scrollHeight; }
function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
}

// Some models (for example Qwen3) write their reasoning inside <think> tags. Hide it.
function visibleText(raw) {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  return { text, thinking: /<think>(?![\s\S]*<\/think>)/.test(raw) };
}

async function send() {
  if (generating) { engine.interruptGenerate(); return; }
  const text = el.input.value.trim();
  if (!text || !engine) return;

  el.input.value = ""; autoGrow();
  history.push({ role: "user", content: text });
  addMsg("user", text);

  const botEl = addMsg("bot", "");
  botEl.classList.add("typing");
  generating = true;
  el.sendBtn.textContent = "Stop";

  let raw = "";
  try {
    const messages = [{ role: "system", content: system }, ...history.slice(-MAX_HISTORY)];
    const stream = await engine.chat.completions.create({
      messages, stream: true, temperature: 0.7, max_tokens: 1024
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (!delta) continue;
      raw += delta;
      const v = visibleText(raw);
      botEl.innerHTML = renderMarkdown(v.text || (v.thinking ? "Thinking..." : ""));
      scrollDown();
    }
    botEl.classList.remove("typing");
    const final = visibleText(raw).text;
    if (final) history.push({ role: "assistant", content: final });
    else { botEl.remove(); history.pop(); addMsg("error", "The model returned no answer. Try rephrasing your message."); }
  } catch (err) {
    botEl.remove();
    history.pop();
    el.input.value = text; autoGrow();
    addMsg("error", "Something went wrong: " + (err && err.message ? err.message : err) +
      " If this keeps happening, start a new chat or pick a smaller model.");
  } finally {
    generating = false;
    el.sendBtn.textContent = "Send";
    el.input.focus();
  }
}

async function newChat() {
  if (generating) engine.interruptGenerate();
  history = [];
  el.thread.innerHTML = "";
  el.hello.hidden = false;
  try { await engine.resetChat(); } catch (e) {}
  el.input.focus();
}

// ---------- start ----------
async function init() {
  el.systemInput.value = store.get("ai.system", "");

  if (!("gpu" in navigator)) {
    el.noGpu.hidden = false;
    el.setupForm.hidden = true;
    return;
  }
  const f16 = await supportsF16();
  const models = buildModelList(f16);
  if (!models.length) {
    showSetupError("No compatible models were found for this device.");
    el.setupForm.hidden = true;
    return;
  }
  fillModelSelect(models);

  el.loadBtn.addEventListener("click", loadModel);
  el.sendBtn.addEventListener("click", send);
  el.input.addEventListener("input", autoGrow);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  el.newBtn.addEventListener("click", newChat);
  el.changeBtn.addEventListener("click", () => {
    if (generating) engine.interruptGenerate();
    el.noGpu.hidden = true;
    show("setup");
  });
}

init();
