/* Difficulty configuration.
 *
 * Two orthogonal axes: grid size (2 to 11) and a named level. Each
 * (gridSize, level) pair maps to a { reveal, minSteps } puzzle-generation
 * config. "Auto" mode derives both axes from a single running score;
 * "Manual" mode lets the player pick either axis directly via Settings.
 *
 * minSteps counts only the deductions the answer actually depends on (the
 * chain the explanation shows), using both rules the solver knows: a square
 * with one shape left, and a shape with one place left in its row/column.
 *
 * Reveal-count vs. reasoning depth is NOT monotonic: strip too many reveals
 * and puzzles mostly stop being solvable, and the rare solvable ones tend to
 * be short lucky chains. Chain length peaks around half to two-thirds of the
 * board revealed and falls off on both sides. So levels climb by moving into
 * that peak band, then raise minSteps to bias toward the longer chains inside
 * it. Every value below was measured by sampling thousands of boards per size
 * (solvable rate and chain-length percentiles per reveal count), not guessed;
 * each Expert preset still succeeds on roughly 1 in 10 attempts or better.
 * Small boards can't support five distinct levels: 2x2 has one, 3x3 three.
 */

const LEVEL_LABELS = ["Easy", "Moderate", "Challenging", "Hard", "Expert"];
const MIN_GRID = 2;
const MAX_GRID = 11;

const PRESETS = {
  2: [{ reveal: [1, 2], minSteps: 1 }],
  3: [
    { reveal: [6, 7], minSteps: 1 },
    { reveal: [4, 5], minSteps: 3 },
    { reveal: [3, 3], minSteps: 4 },
  ],
  4: [
    { reveal: [11, 13], minSteps: 1 },
    { reveal: [9, 10], minSteps: 2 },
    { reveal: [7, 8], minSteps: 3 },
    { reveal: [5, 6], minSteps: 4 },
    { reveal: [5, 6], minSteps: 6 },
  ],
  5: [
    { reveal: [17, 20], minSteps: 1 },
    { reveal: [14, 16], minSteps: 3 },
    { reveal: [12, 14], minSteps: 4 },
    { reveal: [10, 12], minSteps: 6 },
    { reveal: [10, 12], minSteps: 8 },
  ],
  6: [
    { reveal: [27, 30], minSteps: 1 },
    { reveal: [23, 26], minSteps: 3 },
    { reveal: [19, 22], minSteps: 5 },
    { reveal: [17, 19], minSteps: 8 },
    { reveal: [16, 19], minSteps: 11 },
  ],
  7: [
    { reveal: [37, 41], minSteps: 2 },
    { reveal: [31, 35], minSteps: 4 },
    { reveal: [27, 30], minSteps: 6 },
    { reveal: [24, 27], minSteps: 10 },
    { reveal: [23, 26], minSteps: 14 },
  ],
  8: [
    { reveal: [49, 54], minSteps: 2 },
    { reveal: [42, 46], minSteps: 5 },
    { reveal: [37, 41], minSteps: 8 },
    { reveal: [33, 37], minSteps: 13 },
    { reveal: [32, 36], minSteps: 18 },
  ],
  9: [
    { reveal: [63, 68], minSteps: 2 },
    { reveal: [54, 58], minSteps: 6 },
    { reveal: [47, 52], minSteps: 10 },
    { reveal: [43, 47], minSteps: 15 },
    { reveal: [41, 45], minSteps: 20 },
  ],
  10: [
    { reveal: [78, 84], minSteps: 3 },
    { reveal: [68, 73], minSteps: 7 },
    { reveal: [60, 65], minSteps: 12 },
    { reveal: [55, 60], minSteps: 18 },
    { reveal: [54, 58], minSteps: 24 },
  ],
  11: [
    { reveal: [94, 102], minSteps: 3 },
    { reveal: [82, 88], minSteps: 8 },
    { reveal: [74, 80], minSteps: 13 },
    { reveal: [68, 74], minSteps: 20 },
    { reveal: [66, 72], minSteps: 26 },
  ],
};

function levelCountFor(n) {
  return PRESETS[n].length;
}

function presetFor(n, levelIndex) {
  const level = Math.min(levelIndex, levelCountFor(n) - 1);
  const preset = PRESETS[n][level];
  return { n, levelIndex: level, reveal: preset.reveal, minSteps: preset.minSteps, label: `${LEVEL_LABELS[level]} (${n}×${n})` };
}

/* Auto mode starts at 4x4 (2x2 and 3x3 are too small to teach anything) and
   walks every size's levels in order, one step per 3 score points. By default
   it stops at 5x5, the standard core sizes; with "advanced" on it
   keeps climbing, unlocking a new shape with each bigger grid. */
const STANDARD_MAX_GRID = 5;
const AUTO_PROGRESSION = [];
for (let n = 4; n <= MAX_GRID; n++) {
  for (let level = 0; level < levelCountFor(n); level++) {
    AUTO_PROGRESSION.push({ minScore: AUTO_PROGRESSION.length * 3, n, levelIndex: level });
  }
}

function tierForScore(score) {
  let entry = AUTO_PROGRESSION[0];
  for (const e of AUTO_PROGRESSION) {
    if (score >= e.minScore) entry = e;
  }
  return entry;
}

/**
 * Resolves the config to actually generate a puzzle with, given app state.
 * maxN caps the grid size for small screens. In Auto mode the ceiling is 5x5
 * unless advanced progression is on; a player at the ceiling stays on its
 * hardest level (their score keeps counting, so raising the ceiling resumes).
 */
function resolveDifficulty(state, maxN = MAX_GRID) {
  if (state.difficultyMode === "manual") {
    return presetFor(Math.min(state.manualGridSize, maxN), state.manualLevel);
  }
  const ceiling = state.advancedProgress ? maxN : Math.min(STANDARD_MAX_GRID, maxN);
  const tier = tierForScore(state.score);
  if (tier.n > ceiling) return presetFor(ceiling, levelCountFor(ceiling) - 1);
  return presetFor(tier.n, tier.levelIndex);
}

const STORAGE_KEY = "deductive-reasoning-practice:state";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.score !== "number") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore persistence failures (e.g. private browsing) */
  }
}
