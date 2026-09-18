// Offline structural/provenance checks. Does not claim gameplay reachability.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = p => JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8'));
const catalog = read('raw/catalog.json');
const sourceList = read('sources/index.json').sources;
const fixtures = read('raw/fumen-fixtures.json');
const inputs = read('raw/fumen-inputs.json');
const routes = read('raw/ordered-routes.json').routes;
const stacking = read('raw/stacking-targets.json');
const unique = (items, name) => {
  const ids = new Set(items.map(x => x.id));
  assert.equal(ids.size, items.length, `duplicate ${name} id`); return ids;
};
const sources = unique(sourceList, 'source');
const patterns = unique(catalog.patterns, 'pattern');
const diagrams = unique(fixtures.diagrams, 'diagram');
unique(catalog.terms, 'term');
assert.equal(catalog.schemaVersion, 1);
for (const source of sourceList) {
  assert.match(source.url, /^https?:\/\//);
  assert.equal(source.accessedAt, '2026-09-18');
  assert.ok(source.kind.startsWith('primary-'));
}
for (const entry of [...catalog.terms, ...catalog.patterns]) {
  assert.ok(entry.sourceIds.length > 0, `missing sources: ${entry.id}`);
  entry.sourceIds.forEach(id => assert.ok(sources.has(id), `unknown source ${id}`));
}
for (const pattern of catalog.patterns) {
  assert.ok(['opener', 'midgame', 'loop', 'stacking', 'meme'].includes(pattern.category));
  assert.equal(pattern.executable, false, 'Raw catalog must not bypass engine validation');
  assert.equal(pattern.successRate, null, 'No measured success rates have been imported');
  pattern.geometryTemplates.forEach(id => assert.ok(diagrams.has(id), `missing diagram ${id}`));
  pattern.continuations.forEach(id => assert.ok(patterns.has(id), `unknown continuation ${id}`));
}
let pages = 0, operations = 0;
for (const diagram of fixtures.diagrams) {
  assert.ok(patterns.has(diagram.patternId)); assert.ok(sources.has(diagram.sourceId));
  assert.equal(diagram.runtimeEnabled, false);
  assert.equal(diagram.fumen, inputs.diagrams.find(x => x.id === diagram.id).fumen);
  for (const page of diagram.pages) {
    pages++;
    assert.ok(page.boardRowsBottomUp.length <= 23);
    for (const row of [...page.boardRowsBottomUp, page.garbageRow, ...(page.afterOperationRowsBottomUp || [])]) assert.match(row, /^[IOTLJSZX_]{10}$/);
    for (const placement of page.coloredPlacements) {
      assert.equal(placement.cells.length, 4);
      for (const { x, y } of placement.cells) assert.equal(page.boardRowsBottomUp[y][x], placement.type);
    }
    if (page.operation) {
      operations++;
      assert.ok(['spawn', 'right', 'reverse', 'left'].includes(page.operation.rotation));
      assert.ok(Number.isInteger(page.operation.x) && Number.isInteger(page.operation.y));
    }
  }
}
const occupancy = rows => rows.map(row => row.replace(/[IOTLJSZ]/g, 'X'));
assert.ok(!patterns.has('four-three'), 'User correction supersedes old unresolved label');
for (const profile of stacking.wellProfiles) {
  assert.equal(profile.rowExceptWellMask.length, 10);
  assert.equal(profile.rowExceptWellMask[profile.wellColumn], '_');
  assert.equal([...profile.rowExceptWellMask].filter(c => c === '_').length, 1);
  assert.equal(profile.mirrorWellColumn, 9 - profile.wellColumn);
  assert.equal(profile.mirrorRowExceptWellMask, [...profile.rowExceptWellMask].reverse().join(''));
  assert.deepEqual([...profile.leftColumns, profile.wellColumn, ...profile.rightColumns], [0,1,2,3,4,5,6,7,8,9]);
}
for (const phase of stacking.lstPhases) {
  const source = fixtures.diagrams.find(d => d.id === phase.diagramId);
  assert.ok(source);
  assert.equal(phase.runtimeEnabled, false);
  for (const page of phase.pages) assert.deepEqual(page.occupiedRowsBottomUp, occupancy(source.pages[page.sourcePageIndex].boardRowsBottomUp));
}
assert.ok(!catalog.patterns.find(p => p.id === 'lst').geometryTemplates.includes('lst-diagram-2'));
for (const route of routes) {
  const diagram = fixtures.diagrams.find(d => d.id === route.sourceDiagramId);
  assert.ok(diagram);
  assert.equal(route.verification.runtimeEnabled, false);
  assert.equal(route.queue, route.operations.map(op => op.type).join(''));
  route.operations.forEach((op, i) => {
    const page = diagram.pages[i];
    assert.equal(page.operationCanLock, true);
    assert.equal(page.flags.lock, true);
    assert.deepEqual(op, { ...page.operation, expectedLines: page.linesClearedByOperation });
    assert.deepEqual(occupancy(page.afterOperationRowsBottomUp), occupancy(diagram.pages[i + 1].boardRowsBottomUp), 'source edits interrupt route');
  });
  assert.deepEqual(route.initialRowsBottomUp, diagram.pages[0].boardRowsBottomUp);
  assert.deepEqual(route.expectedFinalRowsBottomUp, diagram.pages[route.operations.length].boardRowsBottomUp);
}
console.log(JSON.stringify({ result: 'pass', scope: 'offline structural/provenance and source-route geometry only', sources: sources.size, patterns: patterns.size, terms: catalog.terms.length, diagrams: diagrams.size, pages, operations, orderedRoutes: routes.length, gameplayReachability: 'not-tested' }, null, 2));
