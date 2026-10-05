/* App wiring: state, rendering, event handling. Depends on engine.js and difficulty.js. */

const els = {
  grid: document.getElementById("grid"),
  options: document.getElementById("options"),
  feedback: document.getElementById("feedback"),
  explanation: document.getElementById("explanation"),
  explanationToggle: document.getElementById("explanation-toggle"),
  explanationBody: document.getElementById("explanation-body"),
  nextBtn: document.getElementById("next-btn"),
  statCorrect: document.getElementById("stat-correct"),
  statIncorrect: document.getElementById("stat-incorrect"),
  statStreak: document.getElementById("stat-streak"),
  statTier: document.getElementById("stat-tier"),
  statTimer: document.getElementById("stat-timer"),
  timerToggle: document.getElementById("timer-toggle"),
  timerTotal: document.getElementById("stat-total"),
  timerTotalWrap: document.getElementById("timer-total"),
  timerShowText: document.getElementById("timer-show"),
  themeToggle: document.getElementById("theme-toggle"),
  resetProgress: document.getElementById("reset-progress"),
  settingsToggle: document.getElementById("settings-toggle"),
  helpToggle: document.getElementById("help-toggle"),
  helpPanel: document.getElementById("help-panel"),
  streakWrap: document.getElementById("streak-wrap"),
  board: document.getElementById("board"),
  notePicker: document.getElementById("note-picker"),
  notePickerOptions: document.getElementById("note-picker-options"),
  noteErase: document.getElementById("note-erase"),
  notesHint: document.getElementById("notes-hint"),
  clearNotes: document.getElementById("clear-notes"),
  settingsPanel: document.getElementById("settings-panel"),
  modeSelect: document.getElementById("mode-select"),
  gridSizeSelect: document.getElementById("grid-size-select"),
  levelSelect: document.getElementById("level-select"),
  manualOnlyRows: document.querySelectorAll(".manual-only"),
  autoOnlyRows: document.querySelectorAll(".auto-only"),
  advancedToggle: document.getElementById("advanced-toggle"),
  advancedHint: document.getElementById("advanced-hint"),
  gridCapNote: document.getElementById("grid-cap-note"),
};

const defaultState = {
  score: 0,
  correct: 0,
  incorrect: 0,
  streak: 0,
  theme: "light",
  timerVisible: true,
  // Overall practice time in seconds, counted while the page is open and visible
  totalSeconds: 0,
  difficultyMode: "auto",
  manualGridSize: 4,
  manualLevel: 0,
  // Adaptive mode stops at 5x5 (the standard sizes) unless this is on
  advancedProgress: false,
};

let state = { ...defaultState, ...(loadState() || {}) };
let currentPuzzle = null;
let currentTierLevel = 0;
let answered = false;
let timerSeconds = 0;
let timerInterval = null;
// Player's working notes for the current puzzle: "r,c" -> shapeId. Never scored.
let notes = new Map();
let activeSlot = null;

function persist() {
  saveState(state);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const label = state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  els.themeToggle.setAttribute("aria-label", label);
  els.themeToggle.title = label;
  // Match the mobile browser bar to the top of the wall in each theme
  document.getElementById("theme-color").setAttribute("content", state.theme === "dark" ? "#39383b" : "#f8f7f5");
}

// Phones top out at 7x7: beyond that, tiles get too small to read and tap reliably.
// Judged by the device's short side so rotating a phone doesn't unlock big grids.
const PHONE_MAX_GRID = 7;
function maxGridForScreen() {
  const shortSide = Math.min(window.screen.width, window.screen.height, window.innerWidth);
  return shortSide < 600 ? PHONE_MAX_GRID : MAX_GRID;
}

function currentDifficulty() {
  return resolveDifficulty(state, maxGridForScreen());
}

function updateStatsUI() {
  els.statCorrect.textContent = state.correct;
  els.statIncorrect.textContent = state.incorrect;
  els.statStreak.textContent = state.streak;
  els.statTier.textContent = currentDifficulty().label;
}

function buildGridSizeOptions() {
  const cap = maxGridForScreen();
  els.gridSizeSelect.innerHTML = "";
  for (let n = MIN_GRID; n <= MAX_GRID; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = n > cap ? `${n} × ${n} (larger screen)` : `${n} × ${n}`;
    opt.disabled = n > cap;
    els.gridSizeSelect.appendChild(opt);
  }
}

function applySettingsUI() {
  const size = Math.min(state.manualGridSize, maxGridForScreen());
  els.modeSelect.value = state.difficultyMode;
  els.gridSizeSelect.value = String(size);
  // Small grids support fewer levels (2x2 has one, 3x3 three)
  [...els.levelSelect.options].forEach((opt) => {
    opt.disabled = Number(opt.value) >= levelCountFor(size);
  });
  els.levelSelect.value = String(Math.min(state.manualLevel, levelCountFor(size) - 1));
  els.levelSelect.disabled = levelCountFor(size) === 1;

  const isManual = state.difficultyMode === "manual";
  els.manualOnlyRows.forEach((row) => row.classList.toggle("hidden", !isManual));
  els.autoOnlyRows.forEach((row) => row.classList.toggle("hidden", isManual));
  els.advancedToggle.checked = state.advancedProgress;
  const top = maxGridForScreen();
  els.advancedHint.textContent =
    top < MAX_GRID
      ? `Keep climbing past 5 × 5, up to ${top} × ${top} on this phone. Each bigger grid adds one new shape.`
      : "Keep climbing past 5 × 5, up to 11 × 11. Each bigger grid adds one new shape.";
  els.gridCapNote.classList.toggle("hidden", !isManual || maxGridForScreen() >= MAX_GRID);
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

let totalTicks = 0;

function startTotalTimer() {
  els.timerTotal.textContent = formatTime(state.totalSeconds);
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    state.totalSeconds += 1;
    els.timerTotal.textContent = formatTime(state.totalSeconds);
    // Save every 10s rather than every tick; leaving the page saves immediately below
    if (++totalTicks % 10 === 0) persist();
  }, 1000);
}

function startTimer() {
  stopTimer();
  timerSeconds = 0;
  els.statTimer.textContent = formatTime(0);
  timerInterval = setInterval(() => {
    timerSeconds += 1;
    els.statTimer.textContent = formatTime(timerSeconds);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function renderGrid(puzzle) {
  els.grid.style.setProperty("--grid-size", puzzle.n);
  // Keep the whole deal under ~0.6s however many tiles there are
  els.grid.style.setProperty("--deal-step", `${Math.min(22, 600 / (puzzle.n * puzzle.n))}ms`);
  els.grid.innerHTML = "";
  for (let r = 0; r < puzzle.n; r++) {
    for (let c = 0; c < puzzle.n; c++) {
      const cell = document.createElement("div");
      const isTarget = r === puzzle.targetR && c === puzzle.targetC;
      const value = puzzle.visibleGrid[r][c];
      // Deal order runs row by row so cards land like a dealer laying out a spread
      cell.style.setProperty("--i", r * puzzle.n + c);
      if (isTarget) {
        cell.className = "cell target";
        cell.innerHTML =
          '<div class="flip"><div class="face tile-back"><span class="question-mark" aria-label="Unknown">?</span></div>' +
          '<div class="face tile-front" id="target-front"></div></div>';
      } else if (value !== null) {
        cell.className = "cell card";
        cell.innerHTML = shapeSVGMarkup(value);
      } else {
        const slot = document.createElement("button");
        slot.type = "button";
        slot.className = "cell slot";
        slot.dataset.r = r;
        slot.dataset.c = c;
        slot.style.setProperty("--i", r * puzzle.n + c);
        slot.setAttribute("aria-haspopup", "dialog");
        slot.addEventListener("click", () => openNotePicker(slot));
        els.grid.appendChild(slot);
        continue;
      }
      els.grid.appendChild(cell);
    }
  }
}

/* ---------- Working notes (pencil marks in empty slots) ---------- */

function slotLabel(slot) {
  const where = `row ${Number(slot.dataset.r) + 1}, column ${Number(slot.dataset.c) + 1}`;
  const note = notes.get(`${slot.dataset.r},${slot.dataset.c}`);
  if (!note) return `Empty slot, ${where}. Tap to pencil in a shape.`;
  const clash = slot.classList.contains("clash") ? " Clashes with its row or column." : "";
  return `Your note: ${shapeById(note).name}, ${where}.${clash}`;
}

// A note clashes when its shape already appears in the same row or column,
// either on a given card or in another of the player's notes.
function noteClashes(r, c, shapeId) {
  const n = currentPuzzle.n;
  for (let i = 0; i < n; i++) {
    if (i !== c && (currentPuzzle.visibleGrid[r][i] === shapeId || notes.get(`${r},${i}`) === shapeId)) return true;
    if (i !== r && (currentPuzzle.visibleGrid[i][c] === shapeId || notes.get(`${i},${c}`) === shapeId)) return true;
  }
  return false;
}

function renderNotes() {
  els.grid.querySelectorAll(".cell.slot").forEach((slot) => {
    const { r, c } = slot.dataset;
    const note = notes.get(`${r},${c}`);
    slot.classList.toggle("has-note", Boolean(note));
    slot.classList.toggle("clash", Boolean(note) && noteClashes(Number(r), Number(c), note));
    slot.innerHTML = note ? shapeSVGMarkup(note, "pencil") : "";
    slot.setAttribute("aria-label", slotLabel(slot));
  });
  const hasNotes = notes.size > 0;
  els.clearNotes.classList.toggle("hidden", !hasNotes || answered);
  els.notesHint.classList.toggle("hidden", hasNotes || answered);
}

function buildNotePicker() {
  els.notePickerOptions.innerHTML = "";
  for (const shapeId of currentPuzzle.shapes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-option";
    btn.dataset.shapeId = shapeId;
    btn.setAttribute("aria-label", `Pencil in ${shapeById(shapeId).name}`);
    btn.innerHTML = shapeSVGMarkup(shapeId);
    btn.addEventListener("click", () => setNote(shapeId));
    els.notePickerOptions.appendChild(btn);
  }
}

function positionNotePicker(slot) {
  const boardRect = els.board.getBoundingClientRect();
  const cellRect = slot.getBoundingClientRect();
  const picker = els.notePicker;
  const pw = picker.offsetWidth;
  const ph = picker.offsetHeight;
  const gap = 8;
  const cellCenter = cellRect.left - boardRect.left + cellRect.width / 2;
  // Clamp inside the board; if the picker is wider than the board, centre it on the board instead
  const left =
    pw > boardRect.width
      ? (boardRect.width - pw) / 2
      : Math.min(Math.max(cellCenter - pw / 2, 0), boardRect.width - pw);
  // Prefer sitting below the slot; flip above when it would run off the board
  const below = cellRect.bottom - boardRect.top + gap;
  const above = cellRect.top - boardRect.top - ph - gap;
  const placeAbove = below + ph > boardRect.height && above >= 0;
  picker.style.left = `${left}px`;
  picker.style.top = `${placeAbove ? above : below}px`;
  picker.style.setProperty("--arrow-x", `${cellCenter - left}px`);
  picker.classList.toggle("above", placeAbove);
}

function openNotePicker(slot) {
  if (answered) return;
  if (activeSlot === slot) {
    closeNotePicker();
    return;
  }
  if (activeSlot) activeSlot.classList.remove("active");
  activeSlot = slot;
  slot.classList.add("active");
  slot.setAttribute("aria-expanded", "true");
  const current = notes.get(`${slot.dataset.r},${slot.dataset.c}`);
  els.notePickerOptions.querySelectorAll(".note-option").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.shapeId === current));
  });
  els.noteErase.disabled = !current;
  els.notePicker.classList.remove("hidden");
  positionNotePicker(slot);
  (els.notePickerOptions.querySelector('[aria-pressed="true"]') || els.notePickerOptions.firstElementChild).focus({
    preventScroll: true,
  });
}

function closeNotePicker({ restoreFocus = false } = {}) {
  if (!activeSlot) return;
  const slot = activeSlot;
  slot.classList.remove("active");
  slot.setAttribute("aria-expanded", "false");
  activeSlot = null;
  els.notePicker.classList.add("hidden");
  if (restoreFocus) slot.focus({ preventScroll: true });
}

function setNote(shapeId) {
  if (!activeSlot) return;
  const key = `${activeSlot.dataset.r},${activeSlot.dataset.c}`;
  const slot = activeSlot;
  if (shapeId) notes.set(key, shapeId);
  else notes.delete(key);
  closeNotePicker();
  renderNotes();
  const fresh = els.grid.querySelector(`.cell.slot[data-r="${slot.dataset.r}"][data-c="${slot.dataset.c}"]`);
  fresh.classList.remove("just-noted");
  void fresh.offsetWidth; // restart the pencil-in animation on repeat edits
  fresh.classList.add("just-noted");
  fresh.focus({ preventScroll: true });
}

function renderOptions(puzzle) {
  els.options.innerHTML = "";
  const order = shuffled(puzzle.shapes);
  const perRow = order.length <= 5 ? order.length : Math.ceil(order.length / 2);
  els.options.style.setProperty("--per-row", perRow);
  els.options.classList.toggle("two-rows", perRow < order.length);
  for (const shapeId of order) {
    const btn = document.createElement("button");
    btn.className = "hand-card";
    btn.type = "button";
    btn.dataset.shapeId = shapeId;
    btn.style.setProperty("--fan", perRow < order.length ? 0 : order.indexOf(shapeId) - (order.length - 1) / 2);
    btn.style.setProperty("--deal", order.indexOf(shapeId));
    btn.innerHTML = `<span class="hand-shape">${shapeSVGMarkup(shapeId)}</span><span class="name-plate">${shapeById(shapeId).name}</span>`;
    btn.addEventListener("click", () => handleAnswer(shapeId, btn));
    els.options.appendChild(btn);
  }
}

function listNames(cells) {
  const names = cells.map((cell) => shapeById(cell.shape).name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

function listWords(words) {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
}

function sentenceForStep(step, isFinal) {
  const shapeName = shapeById(step.shape).name;
  const rowNum = step.r + 1;
  const colNum = step.c + 1;
  const parts = [];
  if (step.kind === "hidden") {
    const isRow = step.line === "row";
    const lineName = isRow ? `Row ${step.index + 1}` : `Column ${step.index + 1}`;
    const crossing = isRow ? "column" : "row";
    if (step.blockers.length) {
      const where = step.blockers.map((b) => `${crossing} ${(isRow ? b.c : b.r) + 1}`);
      const those = step.blockers.length > 1 ? `those ${crossing}s already have` : `that ${crossing} already has`;
      parts.push(`${lineName} still needs ${shapeName}. It can't go in ${listWords(where)}, because ${those} ${shapeName}.`);
      parts.push(`So ${shapeName} must go in row ${rowNum}, column ${colNum}.`);
    } else {
      parts.push(`${lineName} still needs ${shapeName}, and row ${rowNum}, column ${colNum} is its only open square.`);
    }
    if (isFinal) parts.push(`That's the ? square, so the answer is ${shapeName}.`);
    return parts.join(" ");
  }
  if (step.rowCells.length) parts.push(`Row ${rowNum} has ${listNames(step.rowCells)}.`);
  if (step.colCells.length) parts.push(`Column ${colNum} has ${listNames(step.colCells)}.`);
  parts.push(`So only ${shapeName} fits row ${rowNum}, column ${colNum}.`);
  if (isFinal) parts.push(`That's the ? square, so the answer is ${shapeName}.`);
  return parts.join(" ");
}

function buildExplanation(puzzle) {
  return puzzle.essential.map((i) => sentenceForStep(puzzle.steps[i], puzzle.steps[i].isTarget));
}

function handleAnswer(shapeId, btn) {
  if (answered) return;
  answered = true;
  stopTimer();

  const isCorrect = shapeId === currentPuzzle.answer;
  [...els.options.children].forEach((b) => (b.disabled = true));
  els.options.classList.add("played");
  closeNotePicker();
  els.grid.querySelectorAll(".cell.slot").forEach((slot) => (slot.disabled = true));
  els.notesHint.classList.add("hidden");
  els.clearNotes.classList.add("hidden");

  const target = els.grid.querySelector(".cell.target");
  document.getElementById("target-front").innerHTML = shapeSVGMarkup(currentPuzzle.answer);
  target.classList.add("revealed", isCorrect ? "is-correct" : "is-incorrect");

  if (isCorrect) {
    btn.classList.add("correct-answer");
    els.feedback.textContent = state.streak >= 2 ? `Correct! ${state.streak + 1} in a row.` : "Correct!";
    els.feedback.className = "feedback correct";
    state.correct += 1;
    state.streak += 1;
    state.score += 1;
  } else {
    btn.classList.add("wrong-answer");
    const correctBtn = [...els.options.children].find(
      (b) => b.dataset.shapeId === currentPuzzle.answer
    );
    if (correctBtn) correctBtn.classList.add("correct-answer");
    els.feedback.textContent = `Not quite — the correct answer was ${shapeById(currentPuzzle.answer).name}.`;
    els.feedback.className = "feedback incorrect";
    state.incorrect += 1;
    state.streak = 0;
    state.score = Math.max(0, state.score - 1);
  }

  els.feedback.classList.remove("hidden");
  els.explanation.classList.remove("hidden");
  els.explanationBody.classList.add("hidden");
  els.explanationToggle.textContent = "Show explanation";
  els.explanationToggle.setAttribute("aria-expanded", "false");
  els.explanationBody.innerHTML = buildExplanation(currentPuzzle)
    .map((s) => `<li>${s}</li>`)
    .join("");
  els.nextBtn.classList.remove("hidden");
  els.nextBtn.focus({ preventScroll: true });
  // On phones the result can land below the fold; bring the next action into reach
  els.nextBtn.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  updateStatsUI();
  els.streakWrap.classList.toggle("lit", isCorrect && state.streak >= 2);
  persist();
}

function newQuestion() {
  answered = false;
  closeNotePicker();
  notes = new Map();
  els.options.classList.remove("played");
  els.streakWrap.classList.remove("lit");
  els.feedback.classList.add("hidden");
  els.explanation.classList.add("hidden");
  els.nextBtn.classList.add("hidden");

  const tier = currentDifficulty();
  currentTierLevel = tier.levelIndex;
  currentPuzzle = generatePuzzle(tier.n, tier.reveal, tier.minSteps);
  // Size bands let the stylesheet tighten gaps and widen the board for big grids
  document.body.dataset.band = tier.n >= 8 ? "lg" : tier.n >= 6 ? "md" : "sm";
  renderGrid(currentPuzzle);
  renderNotes();
  buildNotePicker();
  renderOptions(currentPuzzle);
  updateStatsUI();
  startTimer();
}

function resetProgress() {
  if (!confirm("Reset your score, streak, and difficulty progress?")) return;
  state = { ...defaultState, theme: state.theme, timerVisible: state.timerVisible };
  applySettingsUI();
  persist();
  newQuestion();
}

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
  persist();
});

function applyTimerVisibility() {
  els.statTimer.style.visibility = state.timerVisible ? "visible" : "hidden";
  els.timerTotalWrap.classList.toggle("hidden", !state.timerVisible);
  els.timerShowText.classList.toggle("hidden", state.timerVisible);
  els.timerToggle.setAttribute("aria-label", state.timerVisible ? "Hide timers" : "Show timers");
}

els.timerToggle.addEventListener("click", () => {
  state.timerVisible = !state.timerVisible;
  applyTimerVisibility();
  persist();
});

els.explanationToggle.addEventListener("click", () => {
  const isHidden = els.explanationBody.classList.contains("hidden");
  els.explanationBody.classList.toggle("hidden");
  els.explanationToggle.textContent = isHidden ? "Hide explanation" : "Show explanation";
  els.explanationToggle.setAttribute("aria-expanded", String(isHidden));
});

els.nextBtn.addEventListener("click", newQuestion);

els.noteErase.addEventListener("click", () => setNote(null));
els.clearNotes.addEventListener("click", () => {
  closeNotePicker();
  notes = new Map();
  renderNotes();
});

// Tap anywhere off the picker (and off the slot that opened it) to dismiss
document.addEventListener("pointerdown", (e) => {
  if (!activeSlot) return;
  if (els.notePicker.contains(e.target) || activeSlot.contains(e.target)) return;
  if (e.target.closest && e.target.closest(".cell.slot")) return; // another slot reopens it
  closeNotePicker();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeSlot) closeNotePicker({ restoreFocus: true });
});

window.addEventListener("resize", () => {
  if (activeSlot) positionNotePicker(activeSlot);
});
els.resetProgress.addEventListener("click", resetProgress);

function togglePanel(panel, toggle, otherPanel, otherToggle) {
  const opening = panel.classList.toggle("hidden") === false;
  toggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    otherPanel.classList.add("hidden");
    otherToggle.setAttribute("aria-expanded", "false");
  }
}

els.settingsToggle.addEventListener("click", () =>
  togglePanel(els.settingsPanel, els.settingsToggle, els.helpPanel, els.helpToggle)
);
els.helpToggle.addEventListener("click", () =>
  togglePanel(els.helpPanel, els.helpToggle, els.settingsPanel, els.settingsToggle)
);

els.modeSelect.addEventListener("change", () => {
  state.difficultyMode = els.modeSelect.value;
  applySettingsUI();
  persist();
  newQuestion();
});

els.advancedToggle.addEventListener("change", () => {
  state.advancedProgress = els.advancedToggle.checked;
  persist();
  // Only re-deal if the change actually moves this player to a different board
  const next = currentDifficulty();
  if (next.n !== currentPuzzle.n || next.levelIndex !== currentTierLevel) newQuestion();
  else updateStatsUI();
});

els.gridSizeSelect.addEventListener("change", () => {
  state.manualGridSize = Number(els.gridSizeSelect.value);
  state.manualLevel = Math.min(state.manualLevel, levelCountFor(state.manualGridSize) - 1);
  applySettingsUI();
  persist();
  if (state.difficultyMode === "manual") newQuestion();
});

els.levelSelect.addEventListener("change", () => {
  state.manualLevel = Number(els.levelSelect.value);
  persist();
  if (state.difficultyMode === "manual") newQuestion();
});

applyTheme();
buildGridSizeOptions();
applySettingsUI();
applyTimerVisibility();
startTotalTimer();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
window.addEventListener("pagehide", persist);
updateStatsUI();
newQuestion();
