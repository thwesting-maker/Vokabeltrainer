"use strict";

/* ========================================================================
   Konstanten
   ======================================================================== */
const DE_EN_TARGET = 3;
const EN_DE_TARGET = 2;

const DB_NAME = "vokabeltrainer-db";
const DB_VERSION = 1;
const STORE = "vocab";

/* ========================================================================
   IndexedDB
   ======================================================================== */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDB();

async function dbGetAll() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(obj) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbBulkPut(items) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    items.forEach((it) => store.put(it));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ========================================================================
   In-Memory-Cache der Vokabeln
   ======================================================================== */
let vocabCache = [];

async function reloadVocabCache() {
  vocabCache = await dbGetAll();
  vocabCache.sort((a, b) => {
    const la = (a.lesson || "").localeCompare(b.lesson || "", "de");
    if (la !== 0) return la;
    return a.en.localeCompare(b.en, "de");
  });
  return vocabCache;
}

function isLearned(v) {
  return v.count_de_en >= DE_EN_TARGET && v.count_en_de >= EN_DE_TARGET;
}

async function seedIfEmpty() {
  const all = await dbGetAll();
  if (all.length > 0) return;
  const seed = [
    ["dog", "der Hund, Hund"],
    ["cat", "die Katze, Katze"],
    ["house", "das Haus, Haus"],
    ["water", "das Wasser, Wasser"],
    ["to eat", "essen"],
    ["to drink", "trinken"],
    ["friend", "der Freund, die Freundin, Freund"],
    ["school", "die Schule, Schule"],
    ["big", "groß"],
    ["small", "klein"],
  ].map(([en, de]) => ({
    en,
    de: de.split(",").map((s) => s.trim()).filter(Boolean),
    lesson: "Beispiele",
    count_de_en: 0,
    count_en_de: 0,
  }));
  await dbBulkPut(seed);
}

/* ========================================================================
   Hilfsfunktionen
   ======================================================================== */
function normalize(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isAnyGermanWordMatch(raw, deList) {
  const norm = normalize(raw);
  if (!norm) return false;
  const tokens = new Set();
  deList.forEach((d) => {
    const dn = normalize(d);
    tokens.add(dn);
    dn.split(/[\s/,]+/).forEach((w) => {
      if (w) tokens.add(w);
    });
  });
  return tokens.has(norm);
}

function checkAnswer(card, vocab, rawInput) {
  if (card.dir === "de-en") {
    return normalize(rawInput) === normalize(vocab.en);
  }
  return isAnyGermanWordMatch(rawInput, vocab.de);
}

function getLessons() {
  const set = new Set();
  vocabCache.forEach((v) => {
    if (v.lesson) set.add(v.lesson);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
}

function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/* ========================================================================
   Sprachausgabe (Web Speech API)
   ======================================================================== */
let voicesCache = [];

function loadVoices() {
  voicesCache = "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
  return voicesCache;
}

function getEnglishVoices() {
  return voicesCache.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
}

function isSpeechEnabled() {
  return localStorage.getItem("settings.speechEnabled") !== "false";
}

function getSelectedVoice() {
  const uri = localStorage.getItem("settings.voiceURI");
  if (uri) {
    const found = voicesCache.find((v) => v.voiceURI === uri);
    if (found) return found;
  }
  const englishVoices = getEnglishVoices();
  return (
    englishVoices.find((v) => /en-GB/i.test(v.lang)) ||
    englishVoices.find((v) => /en-US/i.test(v.lang)) ||
    englishVoices[0] ||
    null
  );
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  if (!isSpeechEnabled()) return;
  if (!text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = getSelectedVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else {
    utter.lang = "en-GB";
  }
  synth.speak(utter);
}

function unlockSpeechOnce() {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}
document.addEventListener("touchend", unlockSpeechOnce, { once: true });
document.addEventListener("click", unlockSpeechOnce, { once: true });

if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
    populateVoiceSelect();
  };
}

function populateVoiceSelect() {
  const sel = document.getElementById("voice-select");
  const englishVoices = getEnglishVoices();
  sel.innerHTML = "";
  if (englishVoices.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "Keine englische Stimme gefunden";
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }
  const current = getSelectedVoice();
  englishVoices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    if (current && v.voiceURI === current.voiceURI) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ========================================================================
   Navigation
   ======================================================================== */
const TITLES = {
  home: "Vokabeltrainer",
  "learn-setup": "Lernen",
  learn: "Lernen",
  "learn-done": "Fertig!",
  list: "Alle Vokabeln",
  edit: "Vokabel",
  settings: "Einstellungen",
  scan: "Vokabeln scannen",
};

let currentViewId = "home";
const viewStack = [];

const renderers = {
  home: renderHome,
  "learn-setup": renderLearnSetup,
  list: renderList,
  settings: renderSettings,
};

function switchTo(viewId) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.getElementById("view-" + viewId).classList.add("active");
  currentViewId = viewId;
  document.getElementById("page-title").textContent = TITLES[viewId] || "";
  document.getElementById("btn-back").hidden = viewStack.length === 0;
  if (renderers[viewId]) renderers[viewId]();
}

function navigate(viewId) {
  if (viewId !== currentViewId) viewStack.push(currentViewId);
  switchTo(viewId);
}

function goBack() {
  const prev = viewStack.pop() || "home";
  switchTo(prev);
}

document.getElementById("btn-back").addEventListener("click", goBack);
document.getElementById("btn-settings").addEventListener("click", () => navigate("settings"));

/* ========================================================================
   Home
   ======================================================================== */
function renderHome() {
  const total = vocabCache.length;
  const learned = vocabCache.filter(isLearned).length;
  document.getElementById("stat-learned").textContent = learned;
  document.getElementById("stat-total").textContent = total;
  const pct = total === 0 ? 0 : Math.round((learned / total) * 100);
  document.getElementById("home-progress-fill").style.width = pct + "%";
}

document.getElementById("btn-start-learn").addEventListener("click", () => navigate("learn-setup"));
document.getElementById("btn-vocab-list").addEventListener("click", () => navigate("list"));
document.getElementById("btn-add-vocab").addEventListener("click", () => openEdit(null, "home"));
document.getElementById("btn-scan-photo").addEventListener("click", () => {
  resetScanView();
  navigate("scan");
});

/* ========================================================================
   Lern-Setup
   ======================================================================== */
let selectedDirection = "mixed";

function populateLessonSelect(selectEl, lessons) {
  const prevValue = selectEl.value;
  selectEl.innerHTML = '<option value="">Alle Lektionen</option>';
  lessons.forEach((lesson) => {
    const opt = document.createElement("option");
    opt.value = lesson;
    opt.textContent = lesson;
    selectEl.appendChild(opt);
  });
  if (lessons.includes(prevValue)) selectEl.value = prevValue;
}

function renderLearnSetup() {
  populateLessonSelect(document.getElementById("lesson-filter"), getLessons());
  document.querySelectorAll("#direction-choice .choice-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.dir === selectedDirection);
  });
  updateLearnSetupInfo();
}

function buildSessionCards(direction, lessonFilter) {
  const vocabs = vocabCache.filter((v) => !lessonFilter || v.lesson === lessonFilter);
  const cards = [];
  vocabs.forEach((v) => {
    if ((direction === "de-en" || direction === "mixed") && v.count_de_en < DE_EN_TARGET) {
      cards.push({ vocabId: v.id, dir: "de-en" });
    }
    if ((direction === "en-de" || direction === "mixed") && v.count_en_de < EN_DE_TARGET) {
      cards.push({ vocabId: v.id, dir: "en-de" });
    }
  });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function updateLearnSetupInfo() {
  const lessonFilter = document.getElementById("lesson-filter").value;
  const cards = buildSessionCards(selectedDirection, lessonFilter);
  const info = document.getElementById("learn-setup-info");
  info.textContent = cards.length === 0 ? "🎉 In dieser Auswahl ist schon alles gelernt!" : `${cards.length} Abfragen warten auf dich.`;
}

document.querySelectorAll("#direction-choice .choice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedDirection = btn.dataset.dir;
    document.querySelectorAll("#direction-choice .choice-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    updateLearnSetupInfo();
  });
});
document.getElementById("lesson-filter").addEventListener("change", updateLearnSetupInfo);

document.getElementById("btn-begin-learning").addEventListener("click", () => {
  const lessonFilter = document.getElementById("lesson-filter").value;
  const cards = buildSessionCards(selectedDirection, lessonFilter);
  if (cards.length === 0) {
    toast("Keine offenen Vokabeln in dieser Auswahl.");
    return;
  }
  startSession(cards);
});

/* ========================================================================
   Lernmodus
   ======================================================================== */
let session = null;
let currentSpeakText = "";

function startSession(cards) {
  session = { queue: cards, total: cards.length, done: 0 };
  navigate("learn");
  renderCurrentCard();
}

function vocabById(id) {
  return vocabCache.find((v) => v.id === id);
}

function renderCurrentCard() {
  if (!session || session.queue.length === 0) {
    finishSession();
    return;
  }
  const card = session.queue[0];
  const vocab = vocabById(card.vocabId);

  document.getElementById("learn-progress-text").textContent = `${session.done} von ${session.total} richtig`;
  document.getElementById("learn-progress-fill").style.width = `${Math.round((session.done / session.total) * 100)}%`;

  const feedback = document.getElementById("feedback-box");
  feedback.hidden = true;
  feedback.className = "feedback-box";

  const input = document.getElementById("answer-input");
  input.value = "";
  input.disabled = false;

  document.getElementById("btn-check-answer").hidden = false;
  document.getElementById("btn-next-card").hidden = true;

  const speakBtn = document.getElementById("btn-speak-card");

  if (card.dir === "de-en") {
    document.getElementById("card-direction-label").textContent = "Deutsch → Englisch";
    document.getElementById("card-word").textContent = vocab.de.join(" / ");
    input.placeholder = "Englisch eingeben…";
    speakBtn.hidden = true;
    currentSpeakText = "";
  } else {
    document.getElementById("card-direction-label").textContent = "Englisch → Deutsch";
    document.getElementById("card-word").textContent = vocab.en;
    input.placeholder = "Deutsch eingeben…";
    currentSpeakText = vocab.en;
    speakBtn.hidden = false;
    speak(vocab.en);
  }

  input.focus();
}

document.getElementById("btn-speak-card").addEventListener("click", () => speak(currentSpeakText));

document.getElementById("answer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("answer-input");
  if (input.disabled) return;
  const raw = input.value;
  if (!raw.trim()) {
    input.focus();
    return;
  }

  const card = session.queue.shift();
  const vocab = vocabById(card.vocabId);
  const correct = checkAnswer(card, vocab, raw);

  const feedback = document.getElementById("feedback-box");
  feedback.hidden = false;
  const speakBtn = document.getElementById("btn-speak-card");

  if (correct) {
    if (card.dir === "de-en") {
      vocab.count_de_en = Math.min(DE_EN_TARGET, vocab.count_de_en + 1);
    } else {
      vocab.count_en_de = Math.min(EN_DE_TARGET, vocab.count_en_de + 1);
    }
    await dbPut(vocab);
    session.done++;

    feedback.className = "feedback-box correct";
    feedback.textContent = "Richtig! 🎉";

    if (card.dir === "de-en") {
      currentSpeakText = vocab.en;
      speakBtn.hidden = false;
      speak(vocab.en);
    }
  } else {
    session.queue.push(card);

    feedback.className = "feedback-box wrong";
    feedback.textContent =
      card.dir === "de-en" ? `Richtig wäre: ${vocab.en}` : `Richtig wäre: ${vocab.de.join(" / ")}`;

    if (card.dir === "de-en") {
      currentSpeakText = vocab.en;
      speakBtn.hidden = false;
      speak(vocab.en);
    }
  }

  document.getElementById("learn-progress-text").textContent = `${session.done} von ${session.total} richtig`;
  document.getElementById("learn-progress-fill").style.width = `${Math.round((session.done / session.total) * 100)}%`;

  input.disabled = true;
  document.getElementById("btn-check-answer").hidden = true;
  document.getElementById("btn-next-card").hidden = false;
  document.getElementById("btn-next-card").focus();
});

document.getElementById("btn-next-card").addEventListener("click", renderCurrentCard);

function finishSession() {
  document.getElementById("learn-done-text").textContent = `Du hast ${session.done} Abfragen in dieser Runde richtig beantwortet.`;
  session = null;
  switchTo("learn-done");
}

document.getElementById("btn-done-home").addEventListener("click", () => {
  viewStack.length = 0;
  switchTo("home");
});
document.getElementById("btn-done-again").addEventListener("click", () => {
  viewStack.length = 0;
  switchTo("learn-setup");
});

/* ========================================================================
   Vokabelliste
   ======================================================================== */
function renderList() {
  populateLessonSelect(document.getElementById("list-lesson-filter"), getLessons());

  const lessonFilter = document.getElementById("list-lesson-filter").value;
  const statusFilter = document.getElementById("list-status-filter").value;

  const items = vocabCache.filter((v) => {
    if (lessonFilter && v.lesson !== lessonFilter) return false;
    if (statusFilter === "learned" && !isLearned(v)) return false;
    if (statusFilter === "open" && isLearned(v)) return false;
    return true;
  });

  const ul = document.getElementById("vocab-list");
  ul.innerHTML = "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "Keine Vokabeln gefunden.";
    ul.appendChild(li);
    return;
  }

  items.forEach((v) => {
    const li = document.createElement("li");
    li.className = "vocab-item";
    li.dataset.id = v.id;

    const text = document.createElement("div");
    text.className = "vocab-item-text";
    const en = document.createElement("div");
    en.className = "vocab-item-en";
    en.textContent = v.en;
    const de = document.createElement("div");
    de.className = "vocab-item-de";
    de.textContent = v.de.join(" / ");
    text.appendChild(en);
    text.appendChild(de);

    const badges = document.createElement("div");
    badges.className = "vocab-item-badges";
    if (isLearned(v)) {
      const b = document.createElement("span");
      b.className = "badge done";
      b.textContent = "✓ Gelernt";
      badges.appendChild(b);
    } else {
      const b1 = document.createElement("span");
      b1.className = "badge";
      b1.textContent = `DE→EN ${v.count_de_en}/${DE_EN_TARGET}`;
      const b2 = document.createElement("span");
      b2.className = "badge";
      b2.textContent = `EN→DE ${v.count_en_de}/${EN_DE_TARGET}`;
      badges.appendChild(b1);
      badges.appendChild(b2);
    }

    li.appendChild(text);
    li.appendChild(badges);
    li.addEventListener("click", () => openEdit(v, "list"));
    ul.appendChild(li);
  });
}

document.getElementById("list-lesson-filter").addEventListener("change", renderList);
document.getElementById("list-status-filter").addEventListener("change", renderList);
document.getElementById("btn-list-add").addEventListener("click", () => openEdit(null, "list"));

/* ========================================================================
   Vokabel hinzufügen / bearbeiten
   ======================================================================== */
let editingId = null;

function openEdit(vocab, returnTo) {
  editingId = vocab ? vocab.id : null;
  document.getElementById("input-en").value = vocab ? vocab.en : "";
  document.getElementById("input-de").value = vocab ? vocab.de.join(", ") : "";
  document.getElementById("input-lesson").value = vocab ? vocab.lesson || "" : "";
  document.getElementById("btn-delete-vocab").hidden = !vocab;
  TITLES.edit = vocab ? "Vokabel bearbeiten" : "Vokabel hinzufügen";
  navigate("edit");
  document.getElementById("page-title").textContent = TITLES.edit;
  document.getElementById("input-en").focus();
}

document.getElementById("vocab-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const en = document.getElementById("input-en").value.trim();
  const deRaw = document.getElementById("input-de").value;
  const de = deRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const lesson = document.getElementById("input-lesson").value.trim();

  if (!en || de.length === 0) {
    toast("Bitte Englisch und Deutsch ausfüllen.");
    return;
  }

  if (editingId) {
    const existing = vocabById(editingId);
    existing.en = en;
    existing.de = de;
    existing.lesson = lesson;
    await dbPut(existing);
  } else {
    await dbPut({ en, de, lesson, count_de_en: 0, count_en_de: 0 });
  }

  await reloadVocabCache();
  toast("Gespeichert ✓");
  goBack();
});

document.getElementById("btn-delete-vocab").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Diese Vokabel wirklich löschen?")) return;
  await dbDelete(editingId);
  await reloadVocabCache();
  toast("Gelöscht");
  goBack();
});

document.getElementById("btn-cancel-edit").addEventListener("click", goBack);

/* ========================================================================
   Einstellungen
   ======================================================================== */
function renderSettings() {
  document.getElementById("toggle-speech").checked = isSpeechEnabled();
  populateVoiceSelect();
  document.getElementById("settings-message").textContent = "";
}

document.getElementById("toggle-speech").addEventListener("change", (e) => {
  localStorage.setItem("settings.speechEnabled", e.target.checked ? "true" : "false");
});

document.getElementById("voice-select").addEventListener("change", (e) => {
  localStorage.setItem("settings.voiceURI", e.target.value);
});

document.getElementById("btn-reset-progress").addEventListener("click", async () => {
  if (!confirm("Lernfortschritt für alle Vokabeln wirklich zurücksetzen?")) return;
  vocabCache.forEach((v) => {
    v.count_de_en = 0;
    v.count_en_de = 0;
  });
  await dbBulkPut(vocabCache);
  document.getElementById("settings-message").textContent = "Fortschritt wurde zurückgesetzt.";
  toast("Fortschritt zurückgesetzt");
});

document.getElementById("btn-delete-all").addEventListener("click", async () => {
  if (!confirm(`Wirklich ALLE ${vocabCache.length} Vokabeln auf diesem Gerät unwiderruflich löschen?`)) return;
  await dbClear();
  await reloadVocabCache();
  document.getElementById("settings-message").textContent = "Alle Vokabeln wurden gelöscht.";
  toast("Alle Vokabeln gelöscht");
});

/* ---- Export ---- */
document.getElementById("btn-export").addEventListener("click", async () => {
  const data = { exportedAt: new Date().toISOString(), vocab: vocabCache };
  const json = JSON.stringify(data, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `vokabeln-export-${stamp}.json`;
  const blob = new Blob([json], { type: "application/json" });

  try {
    const file = new File([blob], filename, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Vokabeln Export" });
      return;
    }
  } catch (err) {
    // Fallback unten
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  document.getElementById("settings-message").textContent = "Export heruntergeladen.";
});

/* ---- Gemeinsame Import-Logik (Datei & Server) ---- */
function cleanImportList(parsed) {
  const list = Array.isArray(parsed) ? parsed : parsed.vocab;
  if (!Array.isArray(list)) throw new Error("Ungültiges Format");

  const cleaned = list
    .filter((v) => v && typeof v.en === "string" && Array.isArray(v.de))
    .map((v) => ({
      ...(typeof v.id === "number" ? { id: v.id } : {}),
      en: v.en,
      de: v.de,
      lesson: v.lesson || "",
      count_de_en: Number.isInteger(v.count_de_en) ? v.count_de_en : 0,
      count_en_de: Number.isInteger(v.count_en_de) ? v.count_en_de : 0,
    }));

  if (cleaned.length === 0) throw new Error("Keine Vokabeln gefunden");
  return cleaned;
}

/**
 * Gleicht importierte Einträge ohne numerische ID gegen vorhandene Vokabeln ab (per Englisch-Wort),
 * damit ein erneuter Import/Sync bestehende Einträge aktualisiert statt Dubletten anzulegen.
 * Vorhandener Lernfortschritt (Zähler) bleibt dabei erhalten.
 */
function mergeAgainstExisting(cleaned) {
  const byEn = new Map(vocabCache.map((v) => [normalize(v.en), v]));
  return cleaned.map((item) => {
    const existing = item.id != null ? vocabById(item.id) : byEn.get(normalize(item.en));
    if (existing) {
      return { id: existing.id, en: item.en, de: item.de, lesson: item.lesson, count_de_en: existing.count_de_en, count_en_de: existing.count_en_de };
    }
    return item;
  });
}

async function applyImport(cleaned) {
  const merged = mergeAgainstExisting(cleaned);
  const newCount = merged.filter((v) => v.id == null).length;
  const updateCount = merged.length - newCount;
  if (!confirm(`${newCount} neue Vokabeln hinzufügen, ${updateCount} vorhandene aktualisieren?`)) return false;
  await dbBulkPut(merged);
  await reloadVocabCache();
  document.getElementById("settings-message").textContent = `${merged.length} Vokabeln importiert.`;
  toast("Import erfolgreich ✓");
  return true;
}

/* ---- Import aus Datei ---- */
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file-input").click();
});

document.getElementById("import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const cleaned = cleanImportList(JSON.parse(text));
    await applyImport(cleaned);
  } catch (err) {
    document.getElementById("settings-message").textContent = "Import fehlgeschlagen: Datei ungültig.";
    toast("Import fehlgeschlagen");
  }
});

/* ---- Zentrale Vokabelliste vom Server laden ---- */
document.getElementById("btn-load-server").addEventListener("click", async () => {
  const msg = document.getElementById("settings-message");
  msg.textContent = "Lade Vokabelliste vom Server…";
  try {
    // Zeitstempel als Cache-Buster, damit der Service Worker nicht eine veraltete Fassung ausliefert.
    const res = await fetch("data/vokabeln.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Server antwortet mit Fehler " + res.status);
    const cleaned = cleanImportList(await res.json());
    const applied = await applyImport(cleaned);
    if (!applied) msg.textContent = "";
  } catch (err) {
    msg.textContent = "Laden fehlgeschlagen. Internetverbindung prüfen.";
    toast("Laden vom Server fehlgeschlagen");
  }
});

/* ========================================================================
   Foto-Scan (Phase 2) — Texterkennung mit Tesseract.js
   ======================================================================== */
const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
let tesseractScriptPromise = null;

function loadTesseractScript() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractScriptPromise) return tesseractScriptPromise;
  tesseractScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_SRC;
    script.onload = () => resolve();
    script.onerror = () => {
      tesseractScriptPromise = null;
      reject(new Error("Texterkennung konnte nicht geladen werden. Internetverbindung prüfen."));
    };
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

const SCAN_STATUS_LABELS = {
  "loading tesseract core": "Lade Erkennungs-Engine…",
  "initializing tesseract": "Initialisiere…",
  "loading language traineddata": "Lade Sprachdaten…",
  "initializing api": "Bereite Erkennung vor…",
  "recognizing text": "Erkenne Text…",
};

function setScanProgress(text, progress) {
  document.getElementById("scan-progress-text").textContent = text;
  document.getElementById("scan-progress-fill").style.width = Math.round((progress || 0) * 100) + "%";
}

async function recognizeImage(file, onProgress) {
  const worker = await Tesseract.createWorker(["eng", "deu"], 1, {
    logger: (m) => {
      if (m.status) onProgress(SCAN_STATUS_LABELS[m.status] || "Verarbeite…", m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true });
    return data;
  } finally {
    await worker.terminate();
  }
}

/** Fasst die von Tesseract erkannten Blöcke zu einer flachen Liste von Zeilen (je ein Array aus Wörtern) zusammen. */
function extractOcrLines(data) {
  const lines = [];
  (data.blocks || []).forEach((block) => {
    (block.paragraphs || []).forEach((para) => {
      (para.lines || []).forEach((line) => {
        const words = (line.words || []).filter((w) => w.text && w.text.trim() && w.confidence > 25);
        if (words.length > 0) lines.push(words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0));
      });
    });
  });
  return lines;
}

/** Versucht pro Zeile die größte horizontale Lücke zu finden — das ist vermutlich die Spaltengrenze Englisch | Deutsch. */
function findLineGapX(words) {
  if (words.length < 2) return null;
  let maxGap = -Infinity;
  let gapX = null;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
    if (gap > maxGap) {
      maxGap = gap;
      gapX = (words[i].bbox.x0 + words[i - 1].bbox.x1) / 2;
    }
  }
  const avgWidth = words.reduce((sum, w) => sum + (w.bbox.x1 - w.bbox.x0), 0) / words.length;
  return maxGap > avgWidth * 0.9 && maxGap > 15 ? gapX : null;
}

/** Ordnet erkannte Zeilen anhand der Wortpositionen zweispaltig Englisch | Deutsch zu. */
function buildPairsFromOcrData(data) {
  const lines = extractOcrLines(data);

  const candidates = lines.map(findLineGapX).filter((x) => x !== null);
  let globalSplit = null;
  if (candidates.length > 0) {
    candidates.sort((a, b) => a - b);
    globalSplit = candidates[Math.floor(candidates.length / 2)];
  }

  const pairs = [];
  lines.forEach((words) => {
    const splitX = findLineGapX(words) ?? globalSplit;
    if (splitX === null) {
      pairs.push({ en: words.map((w) => w.text.trim()).join(" ").trim(), de: "" });
      return;
    }
    const enWords = words.filter((w) => (w.bbox.x0 + w.bbox.x1) / 2 < splitX);
    const deWords = words.filter((w) => (w.bbox.x0 + w.bbox.x1) / 2 >= splitX);
    const en = enWords.map((w) => w.text.trim()).join(" ").trim();
    const de = deWords.map((w) => w.text.trim()).join(" ").trim();
    if (en || de) pairs.push({ en, de });
  });
  return pairs;
}

/* ---- UI ---- */
let scanRowCounter = 0;

function resetScanView() {
  document.getElementById("scan-step-pick").hidden = false;
  document.getElementById("scan-step-progress").hidden = true;
  document.getElementById("scan-step-correct").hidden = true;
  const img = document.getElementById("scan-preview");
  if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.src = "";
  img.hidden = true;
  document.getElementById("scan-rows").innerHTML = "";
  document.getElementById("scan-lesson").value = "";
  document.getElementById("scan-file-input").value = "";
  scanRowCounter = 0;
}

function addScanRow(en, de) {
  scanRowCounter++;
  const row = document.createElement("div");
  row.className = "scan-row";
  row.innerHTML = `
    <div class="scan-row-header">
      <span class="scan-row-label">Paar ${scanRowCounter}</span>
      <button type="button" class="icon-btn scan-row-delete" aria-label="Zeile löschen">🗑️</button>
    </div>
    <input type="text" class="text-input scan-row-en" placeholder="Englisch" autocapitalize="off" autocorrect="off" spellcheck="false">
    <input type="text" class="text-input scan-row-de" placeholder="Deutsch" autocapitalize="off" autocorrect="off" spellcheck="false">
  `;
  row.querySelector(".scan-row-en").value = en || "";
  row.querySelector(".scan-row-de").value = de || "";
  row.querySelector(".scan-row-delete").addEventListener("click", () => {
    row.remove();
    document.querySelectorAll("#scan-rows .scan-row").forEach((r, idx) => {
      r.querySelector(".scan-row-label").textContent = `Paar ${idx + 1}`;
    });
  });
  document.getElementById("scan-rows").appendChild(row);
}

function showCorrectionRows(pairs) {
  document.getElementById("scan-step-progress").hidden = true;
  document.getElementById("scan-step-correct").hidden = false;
  document.getElementById("scan-rows").innerHTML = "";
  scanRowCounter = 0;

  document.getElementById("scan-correct-info").textContent =
    pairs.length === 0
      ? "Keine Tabelle erkannt. Du kannst Zeilen manuell hinzufügen."
      : `${pairs.length} Paare erkannt. Bitte prüfen, korrigieren oder löschen.`;

  pairs.forEach((p) => addScanRow(p.en, p.de));
  if (pairs.length === 0) addScanRow("", "");
}

document.getElementById("scan-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = document.getElementById("scan-preview");
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  document.getElementById("scan-step-pick").hidden = true;
  document.getElementById("scan-step-progress").hidden = false;
  document.getElementById("scan-step-correct").hidden = true;
  setScanProgress("Starte Texterkennung…", 0);

  try {
    await loadTesseractScript();
    const data = await recognizeImage(file, setScanProgress);
    const pairs = buildPairsFromOcrData(data);
    showCorrectionRows(pairs);
  } catch (err) {
    toast(err && err.message ? err.message : "Texterkennung fehlgeschlagen.");
    document.getElementById("scan-step-progress").hidden = true;
    document.getElementById("scan-step-pick").hidden = false;
  }
});

document.getElementById("btn-scan-add-row").addEventListener("click", () => addScanRow("", ""));

document.getElementById("btn-scan-save").addEventListener("click", async () => {
  const lesson = document.getElementById("scan-lesson").value.trim();
  const rows = Array.from(document.querySelectorAll("#scan-rows .scan-row"));
  const newVocab = [];
  rows.forEach((row) => {
    const en = row.querySelector(".scan-row-en").value.trim();
    const de = row
      .querySelector(".scan-row-de")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (en && de.length > 0) {
      newVocab.push({ en, de, lesson, count_de_en: 0, count_en_de: 0 });
    }
  });

  if (newVocab.length === 0) {
    toast("Keine gültigen Vokabelpaare zum Speichern.");
    return;
  }

  await dbBulkPut(newVocab);
  await reloadVocabCache();
  toast(`${newVocab.length} Vokabeln gespeichert ✓`);
  resetScanView();
  viewStack.length = 0;
  switchTo("home");
});

document.getElementById("btn-scan-cancel").addEventListener("click", () => {
  resetScanView();
  goBack();
});

/* ========================================================================
   Service Worker
   ======================================================================== */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });

  // Sobald eine neue Service-Worker-Version übernimmt, Seite automatisch neu laden,
  // damit Updates auch in einer bereits offenen App ankommen.
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshing) return;
    swRefreshing = true;
    location.reload();
  });
}

/* ========================================================================
   Start
   ======================================================================== */
(async function init() {
  await seedIfEmpty();
  await reloadVocabCache();
  switchTo("home");
})();
