/* Offline build tool. npm package tetris-fumen@1.1.3 is only needed to regenerate.
 * FUMEN_MODULE may point to an installed module. No network is used here. */
const fs = require('node:fs');
const path = require('node:path');
const { decoder, Mino } = require(process.env.FUMEN_MODULE || 'tetris-fumen');
const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw/fumen-inputs.json')));
const rows = field => {
  const result = Array.from({ length: 23 }, (_, y) => Array.from({ length: 10 }, (_, x) => field.at(x, y)).join(''));
  while (result.length && result.at(-1) === '__________') result.pop();
  return result;
};
const key = cells => cells.map(p => `${p.x},${p.y}`).sort().join(';');
const diagrams = input.diagrams.map(diagram => ({
  ...diagram,
  runtimeEnabled: false,
  verification: { status: 'decoded-source', reachability: 'not-tested', queueCompatibility: 'not-tested' },
  pages: decoder.decode(diagram.fumen).map(page => {
    const field = page.field;
    const boardRowsBottomUp = rows(field);
    const coloredPlacements = [];
    for (const type of 'IOTLJSZ') {
      const cells = [];
      boardRowsBottomUp.forEach((row, y) => [...row].forEach((c, x) => { if (c === type) cells.push({ x, y }); }));
      if (cells.length !== 4) continue;
      let found;
      for (const rotation of ['spawn', 'right', 'reverse', 'left']) {
        for (let y = 0; y < 23 && !found; y++) for (let x = 0; x < 10 && !found; x++) {
          const mino = new Mino(type, rotation, x, y);
          if (key(mino.positions()) === key(cells)) found = { type, rotation, x, y, cells };
        }
        if (found) break;
      }
      if (found) coloredPlacements.push(found);
    }
    const operation = page.operation ? { ...page.operation } : null;
    const operationCanLock = operation ? field.canLock(operation) : null;
    let afterOperationRowsBottomUp = null;
    let linesClearedByOperation = null;
    if (operation && operationCanLock && page.flags.lock) {
      const next = field.copy(); next.fill(operation);
      const before = rows(next).reduce((n, row) => n + [...row].filter(c => c !== '_').length, 0);
      next.clearLine(); afterOperationRowsBottomUp = rows(next);
      const after = afterOperationRowsBottomUp.reduce((n, row) => n + [...row].filter(c => c !== '_').length, 0);
      linesClearedByOperation = (before - after) / 10;
    }
    return {
      index: page.index, boardRowsBottomUp,
      garbageRow: Array.from({ length: 10 }, (_, x) => field.at(x, -1)).join(''),
      operation, flags: page.flags, operationCanLock, linesClearedByOperation,
      afterOperationRowsBottomUp,
      coloredPlacements,
      coloredPlacementsNote: 'Unordered exact four-cell groups recovered from source colors; not a playable sequence. Color can also be diagram annotation.',
    };
  }),
}));
const output = { schemaVersion: 1, researchedAt: input.researchedAt,
  coordinates: { width: 10, xOrigin: 'left-zero', yOrigin: 'bottom-zero', rotation: 'tetris-fumen SRS origin; verify conversion to target engine', empty: '_', genericFilled: 'X', rows: 'bottom-up' },
  decoder: { package: 'tetris-fumen', version: '1.1.3' }, diagrams };
fs.writeFileSync(path.join(__dirname, 'raw/fumen-fixtures.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Decoded ${diagrams.length} diagrams / ${diagrams.reduce((n, d) => n + d.pages.length, 0)} pages`);
