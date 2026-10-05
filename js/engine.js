/* Puzzle engine: shape defs, Latin-square generation, constraint-propagation solver. */

/* The first five shapes (and their soft inks) are reserved for the core 4x4
   and 5x5 boards; smaller boards draw from them
   too. Each grid size above 5x5 unlocks exactly one more shape, in this order,
   so a given size always uses the same set. Look-alikes of the circle
   (semicircle, ring) unlock last. Unlocked shapes take colours from Kelly's
   maximum-contrast set, softened slightly to sit with the core inks. */
const CORE_SHAPE_COUNT = 5;

const SHAPES = [
  { id: "circle", name: "Circle", color: "#8a6b9a" },
  { id: "triangle", name: "Triangle", color: "#6c8a63" },
  { id: "square", name: "Square", color: "#b86f7a" },
  { id: "cross", name: "Cross", color: "#b5823f" },
  { id: "star", name: "Star", color: "#64849e" },
  // Unlocked one per size: 6x6, 7x7, 8x8, 9x9, 10x10, 11x11
  { id: "heart", name: "Heart", color: "#b5303a" },
  { id: "arrow", name: "Arrow", color: "#2f5d8a" },
  { id: "tick", name: "Tick", color: "#2e7d4f" },
  { id: "trefoil", name: "Trefoil", color: "#5a4380" },
  { id: "semicircle", name: "Semicircle", color: "#d9662a" },
  { id: "ring", name: "Ring", color: "#7e7470" },
];

/** Shape ids a grid of size n draws from: core shapes up to 5x5, then one unlock per size. */
function shapePoolForGrid(n) {
  return SHAPES.slice(0, Math.max(CORE_SHAPE_COUNT, n)).map((s) => s.id);
}

function shapeById(id) {
  return SHAPES.find((s) => s.id === id);
}

function starPoints(cx, cy, outerR, innerR, points) {
  const pts = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + i * step;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(" ");
}

/**
 * variant "pencil" draws the outline only, in the grey pencil colour, for shapes
 * the player pencils in themselves (distinct in form, not just colour, from given shapes).
 */
function shapeSVGMarkup(shapeId, variant) {
  const shape = shapeById(shapeId);
  const color = shape.color;
  let inner = "";
  switch (shapeId) {
    case "circle":
      inner = `<circle cx="50" cy="50" r="38" fill="${color}"/>`;
      break;
    case "square":
      inner = `<rect x="14" y="14" width="72" height="72" rx="8" fill="${color}"/>`;
      break;
    case "triangle":
      inner = `<polygon points="50,10 92,88 8,88" fill="${color}"/>`;
      break;
    case "cross":
      inner = `<path d="M38,8 H62 V38 H92 V62 H62 V92 H38 V62 H8 V38 H38 Z" fill="${color}"/>`;
      break;
    case "star":
      inner = `<polygon points="${starPoints(50, 52, 42, 17, 5)}" fill="${color}"/>`;
      break;
    case "heart":
      inner = `<path d="M50,88 C22,68 8,50 8,33 C8,19 19,9 32,9 C40,9 46,13 50,21 C54,13 60,9 68,9 C81,9 92,19 92,33 C92,50 78,68 50,88 Z" fill="${color}"/>`;
      break;
    case "semicircle":
      inner = `<path d="M8,71 A42,42 0 0 1 92,71 Z" fill="${color}"/>`;
      break;
    case "tick":
      inner = `<polygon points="10,52 25,37 41,53 75,15 90,30 41,84" fill="${color}"/>`;
      break;
    case "arrow":
      inner = `<path d="M8,37 H50 V14 L92,50 L50,86 V63 H8 Z" fill="${color}"/>`;
      break;
    case "trefoil":
      inner = `<path d="M31.8,40 A21,21 0 1,1 68.2,40 A21,21 0 1,1 50,71.5 A21,21 0 1,1 31.8,40 Z" fill="${color}"/>`;
      break;
    case "ring":
      inner = `<path fill-rule="evenodd" d="M50,10 A40,40 0 1,0 50.01,10 Z M50,29 A21,21 0 1,1 49.99,29 Z" fill="${color}"/>`;
      break;
    default:
      inner = "";
  }
  if (variant === "pencil") {
    inner = inner.replaceAll(
      `fill="${color}"`,
      `fill="none" stroke="${color}" style="stroke: var(--pencil)" stroke-width="9" stroke-linejoin="round"`
    );
    return `<svg viewBox="-6 -6 112 112" class="shape-svg pencil-svg" aria-hidden="true">${inner}</svg>`;
  }
  return `<svg viewBox="0 0 100 100" class="shape-svg" role="img" aria-label="${shape.name}">${inner}</svg>`;
}

/** Fisher-Yates shuffle, returns a new array. */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Builds a randomized n x n Latin square using `n` shape ids from `shapeIdPool`.
 * grid[r][c] holds a shapeId; every row/column contains each chosen shape exactly once.
 *
 * Rows are added one at a time, each as a random perfect matching between
 * columns and the symbols still free in that column. A Latin rectangle can
 * always be extended (Hall's theorem), so this never dead-ends, and unlike a
 * shuffled cyclic square it leaves no diagonal pattern to exploit on big grids.
 */
function generateLatinSquare(n, shapeIdPool) {
  const chosenShapes = shuffled(shapeIdPool).slice(0, n);
  const used = Array.from({ length: n }, () => new Set()); // symbols already in each column
  const rows = [];

  for (let r = 0; r < n; r++) {
    const symbolToCol = new Array(n).fill(-1);
    const colToSymbol = new Array(n).fill(-1);
    const tryCol = (c, seen) => {
      for (const sym of shuffled([...Array(n).keys()])) {
        if (used[c].has(sym) || seen[sym]) continue;
        seen[sym] = true;
        if (symbolToCol[sym] === -1 || tryCol(symbolToCol[sym], seen)) {
          symbolToCol[sym] = c;
          colToSymbol[c] = sym;
          return true;
        }
      }
      return false;
    };
    for (const c of shuffled([...Array(n).keys()])) tryCol(c, new Array(n).fill(false));
    colToSymbol.forEach((sym, c) => used[c].add(sym));
    rows.push(colToSymbol);
  }

  const grid = rows.map((row) => row.map((sym) => chosenShapes[sym]));
  return { grid, shapes: chosenShapes };
}

function candidatesFor(known, n, shapeIds, r, c) {
  if (known[r][c] !== null) return [];
  const rowShapes = new Set(known[r]);
  const colShapes = new Set(known.map((row) => row[c]));
  return shapeIds.filter((s) => !rowShapes.has(s) && !colShapes.has(s));
}

/**
 * Constraint-propagation solver using the two deductions a person makes:
 *  - "single": a square has only one shape left that its row and column allow;
 *  - "hidden": a row or column still needs a shape, and only one of its open
 *    squares can take it (every other open square sees that shape in its line).
 * Safe because the board comes from a real Latin square: any forced placement
 * can only equal the true value. Each step records the cells it relied on
 * (`deps`) so the explanation can include exactly the steps that matter.
 */
function solvePuzzle(knownGrid, n, shapeIds, targetR, targetC) {
  const known = knownGrid.map((row) => row.slice());
  const steps = [];
  const deduced = new Set(); // "r,c" of squares filled by earlier steps rather than given

  const findInCol = (c, shape) => {
    for (let r = 0; r < n; r++) if (known[r][c] === shape) return { r, c, shape };
    return null;
  };
  const findInRow = (r, shape) => {
    for (let c = 0; c < n; c++) if (known[r][c] === shape) return { r, c, shape };
    return null;
  };

  function nakedSingle() {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (known[r][c] !== null) continue;
        const cands = candidatesFor(known, n, shapeIds, r, c);
        if (cands.length !== 1) continue;
        const rowCells = [];
        for (let cc = 0; cc < n; cc++) {
          if (cc !== c && known[r][cc] !== null) rowCells.push({ r, c: cc, shape: known[r][cc] });
        }
        const colCells = [];
        for (let rr = 0; rr < n; rr++) {
          if (rr !== r && known[rr][c] !== null) colCells.push({ r: rr, c, shape: known[rr][c] });
        }
        return { kind: "single", r, c, shape: cands[0], rowCells, colCells, deps: [...rowCells, ...colCells] };
      }
    }
    return null;
  }

  function hiddenSingle() {
    for (const line of ["row", "col"]) {
      for (let i = 0; i < n; i++) {
        const cells = [...Array(n).keys()].map((j) => (line === "row" ? [i, j] : [j, i]));
        const lineShapes = new Set(cells.map(([r, c]) => known[r][c]));
        for (const shape of shapeIds) {
          if (lineShapes.has(shape)) continue;
          const open = cells.filter(([r, c]) => known[r][c] === null);
          const spots = open.filter(([r, c]) => candidatesFor(known, n, shapeIds, r, c).includes(shape));
          if (spots.length !== 1) continue;
          const [r, c] = spots[0];
          // Every other open square in the line is blocked by the shape sitting in its crossing line
          const blockers = open
            .filter(([rr, cc]) => rr !== r || cc !== c)
            .map(([rr, cc]) => (line === "row" ? findInCol(cc, shape) : findInRow(rr, shape)));
          // Squares in the line already filled by earlier deductions are part of the reasoning too
          const filledEarlier = cells
            .filter(([rr, cc]) => deduced.has(`${rr},${cc}`))
            .map(([rr, cc]) => ({ r: rr, c: cc, shape: known[rr][cc] }));
          return { kind: "hidden", line, index: i, r, c, shape, blockers, deps: [...blockers, ...filledEarlier] };
        }
      }
    }
    return null;
  }

  while (known[targetR][targetC] === null) {
    const step = nakedSingle() || hiddenSingle();
    if (!step) break;
    known[step.r][step.c] = step.shape;
    deduced.add(`${step.r},${step.c}`);
    step.isTarget = step.r === targetR && step.c === targetC;
    steps.push(step);
  }
  return { solved: known[targetR][targetC] !== null, steps, known };
}

/**
 * Indices (in solve order) of only the steps the target actually depends on.
 * This is the chain the explanation shows, and the measure of reasoning depth.
 */
function essentialStepIndices(steps) {
  const stepByCell = new Map();
  steps.forEach((st, i) => stepByCell.set(`${st.r},${st.c}`, i));
  const needed = new Set();
  const include = (i) => {
    if (needed.has(i)) return;
    needed.add(i);
    steps[i].deps.forEach((cell) => {
      const key = `${cell.r},${cell.c}`;
      if (stepByCell.has(key) && stepByCell.get(key) < i) include(stepByCell.get(key));
    });
  };
  const targetIdx = steps.findIndex((st) => st.isTarget);
  if (targetIdx >= 0) include(targetIdx);
  return [...needed].sort((a, b) => a - b);
}

/**
 * Generates a full puzzle: a solved Latin square, a target cell, and a mask
 * of which non-target cells are revealed, tuned to a reveal-count range and
 * a minimum number of deduction steps to keep difficulty consistent.
 */
function generatePuzzle(n, revealRange, minSteps) {
  const attemptsBudget = 80;
  let best = null;

  for (let attempt = 0; attempt < attemptsBudget; attempt++) {
    const { grid, shapes } = generateLatinSquare(n, shapePoolForGrid(n));
    const targetR = randInt(0, n - 1);
    const targetC = randInt(0, n - 1);
    const otherCells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (r === targetR && c === targetC) continue;
        otherCells.push([r, c]);
      }
    }
    const revealCount = Math.min(
      otherCells.length,
      randInt(revealRange[0], revealRange[1])
    );
    const revealSet = new Set(
      shuffled(otherCells)
        .slice(0, revealCount)
        .map(([r, c]) => `${r},${c}`)
    );

    const known = Array.from({ length: n }, () => Array(n).fill(null));
    for (const [r, c] of otherCells) {
      if (revealSet.has(`${r},${c}`)) known[r][c] = grid[r][c];
    }

    const result = solvePuzzle(known, n, shapes, targetR, targetC);
    if (!result.solved) continue;

    const candidate = {
      n,
      shapes,
      solutionGrid: grid,
      visibleGrid: known,
      targetR,
      targetC,
      answer: grid[targetR][targetC],
      steps: result.steps,
      essential: essentialStepIndices(result.steps),
    };

    if (candidate.essential.length >= minSteps) {
      return candidate;
    }
    if (!best || candidate.essential.length > best.essential.length) {
      best = candidate;
    }
  }

  // Fallback: relax the reveal count until something solvable is guaranteed.
  if (best) return best;
  return generatePuzzle(n, [revealRange[0] + 1, Math.min(n * n - 1, revealRange[1] + 3)], 1);
}
