const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

// Exercise the actual SFC setup with Vue reactivity and the production model.
// Native dialog/focus are stubbed; these checks do not verify visual layout.
const filename = path.join(__dirname, '..', 'app', 'components', 'RoutineEditor.vue');
const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
const compiled = compileScript(parsed.descriptor, { id: 'routine-editor', genDefaultAs: 'Component' });
const source = compiled.content
  .replace(/^import \{ computed, nextTick, ref \} from 'vue'\s*$/m, 'const { computed, nextTick, ref } = Vue;')
  .replace(/^import Model from '\.\.\/\.\.\/shared\/tracker-model\.mjs'\s*$/m, '');
const componentFactory = new Function('Vue', 'Model', 'window', source + '\nreturn Component;');
const copy = value => JSON.parse(JSON.stringify(value));
let Model;
test.before(async () => { Model = (await import('../shared/tracker-model.mjs')).default; });

function makeEditor({ confirm = true, saveResult = true, saveError } = {}) {
  const data = Model.createDefaultData(new Date(2026, 8, 27, 12));
  const habit = Model.createHabit('checklist');
  habit.name = 'Flute';
  habit.items = [{ id: 'scale', label: 'Scale 1' }, { id: 'piece', label: 'Piece 1' }];
  data.habits.push(habit);
  Model.record(data, '2026-09-27', habit).items.scale = true;
  const saves = [], events = [];
  const props = { data, saveConfiguration(draft) {
    if (saveError) throw new Error(saveError);
    if (saveResult !== false) saves.push(Model.validateData(copy(draft)));
    return saveResult;
  }};
  const Component = componentFactory(Vue, Model, { confirm: () => confirm });
  let exposed;
  const ctx = Component.setup(props, { expose: value => { exposed = value; }, emit: (...args) => events.push(args) });
  ctx.dialog.value = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  return { data, habit, saves, events, exposed, ctx };
}

test('the Vue editor script and template compile without errors', () => {
  assert.deepEqual(parsed.errors, []);
  const template = compileTemplate({ id: 'routine-editor', filename, source: parsed.descriptor.template.content, compilerOptions: { bindingMetadata: compiled.bindings } });
  assert.deepEqual(template.errors, []);
});

test('editing a draft and cancelling never changes live data or progress', async () => {
  const ui = makeEditor(), original = copy(ui.data);
  await ui.exposed.open();
  ui.ctx.habit.value.name = 'My music';
  ui.ctx.habit.value.items[0].label = 'New scale name';
  ui.ctx.archiveAll();
  assert.deepEqual(ui.data, original);
  ui.exposed.close();
  assert.equal(ui.ctx.dialog.value.open, false);
  assert.equal(ui.saves.length, 0);
  await ui.exposed.open();
  await ui.ctx.save();
  assert.deepEqual(ui.saves[0], original);
});

test('saving keeps stable habit and checklist IDs plus all progress', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.habit.value.name = 'Daily music';
  ui.ctx.habit.value.items[0].label = 'D major scale';
  await ui.ctx.save();
  const saved = ui.saves[0];
  assert.equal(saved.habits[0].id, ui.habit.id);
  assert.deepEqual(saved.habits[0].items, [{ id: 'scale', label: 'D major scale' }, { id: 'piece', label: 'Piece 1' }]);
  assert.deepEqual(saved.progress, ui.data.progress);
  assert.equal(ui.data.habits[0].name, 'Flute');
  assert.equal(ui.ctx.dialog.value.open, false);
  assert.deepEqual(ui.events, [['saved']]);
});

test('duplicating creates fresh habit and item IDs without copying progress', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.duplicateHabit(ui.ctx.habit.value);
  await ui.ctx.save();
  const [original, duplicate] = ui.saves[0].habits;
  assert.equal(duplicate.name, 'Flute (copy)');
  assert.notEqual(duplicate.id, original.id);
  assert.ok(duplicate.items.every(item => !original.items.some(other => other.id === item.id)));
  assert.deepEqual(ui.saves[0].progress, ui.data.progress);
});

test('type changes preserve step IDs and convert timer minutes to seconds', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.changeType({ target: { value: 'timer' } });
  ui.ctx.targetInput.value = '1.5';
  ui.ctx.messageText.value = '{habit}: {target} {unit}!';
  assert.equal(ui.ctx.messagePreview.value, 'Preview: Flute: 1.5 minutes!');
  await ui.ctx.save();
  assert.equal(ui.saves[0].habits[0].target, 90);
  assert.equal(ui.saves[0].habits[0].type, 'timer');
  assert.deepEqual(ui.saves[0].habits[0].items, ui.habit.items);
});

test('schedule presets update only the selected habit', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.duplicateHabit(ui.ctx.habit.value);
  ui.ctx.setSchedule('weekdays');
  await ui.ctx.save();
  assert.deepEqual(ui.saves[0].habits[0].weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ui.saves[0].habits[1].weekdays, [1, 2, 3, 4, 5]);
});

test('save rejects an empty schedule and invalid challenge settings', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.habit.value.weekdays = [];
  await ui.ctx.save();
  assert.match(ui.ctx.errorMessage.value, /Choose at least one day/);
  ui.ctx.setSchedule('all');
  ui.ctx.draft.value.challenge.startDate = '2026-02-30';
  await ui.ctx.save();
  assert.match(ui.ctx.errorMessage.value, /Choose a valid start date/);
  ui.ctx.draft.value.challenge.startDate = '2026-09-27';
  ui.ctx.draft.value.challenge.days = 367;
  await ui.ctx.save();
  assert.match(ui.ctx.errorMessage.value, /1–366 whole days/);
  assert.equal(ui.saves.length, 0);
  assert.equal(ui.ctx.dialog.value.open, true);
});

test('counter targets accept decimals and reject zero', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.changeType({ target: { value: 'counter' } });
  ui.ctx.targetInput.value = '0';
  await ui.ctx.save();
  assert.equal(ui.saves.length, 0);
  ui.ctx.targetInput.value = '2.5';
  await ui.ctx.save();
  assert.equal(ui.saves[0].habits[0].target, 2.5);
});

test('checklist reordering and removal retain surviving identities', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.moveItem(1, -1);
  ui.ctx.removeItem(1);
  await ui.ctx.save();
  assert.deepEqual(ui.saves[0].habits[0].items, [{ id: 'piece', label: 'Piece 1' }]);
});

test('an unnamed step cannot become hidden during a type change', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.addItem();
  const event = { target: { value: 'check' } };
  ui.ctx.changeType(event);
  assert.equal(ui.ctx.habit.value.type, 'checklist');
  assert.equal(event.target.value, 'checklist');
  assert.match(ui.ctx.errorMessage.value, /Name every checklist step/);
});

test('custom messages are trimmed and bounded before saving', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.messageText.value = Array(21).fill('Great {habit}!').join('\n');
  await ui.ctx.save();
  assert.equal(ui.saves.length, 0);
  assert.match(ui.ctx.errorMessage.value, /no more than 20/);
  ui.ctx.messageText.value = '  Great {habit}!\n\n Well done on {item}. ';
  await ui.ctx.save();
  assert.deepEqual(ui.saves[0].habits[0].messages, ['Great {habit}!', 'Well done on {item}.']);
});

test('empty-routine action requires confirmation and keeps progress', async () => {
  const denied = makeEditor({ confirm: false });
  await denied.exposed.open();
  denied.ctx.archiveAll();
  await denied.ctx.save();
  assert.equal(denied.saves[0].habits[0].archived, false);
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.archiveAll();
  await ui.ctx.save();
  assert.equal(ui.saves[0].habits[0].archived, true);
  assert.deepEqual(ui.saves[0].progress, ui.data.progress);
});

test('failed persistence keeps the draft open for correction or retry', async () => {
  const ui = makeEditor({ saveError: 'Storage is full.' });
  await ui.exposed.open();
  ui.ctx.habit.value.name = 'Keep my draft';
  await ui.ctx.save();
  assert.equal(ui.ctx.dialog.value.open, true);
  assert.equal(ui.ctx.errorMessage.value, 'Storage is full.');
  assert.equal(ui.ctx.habit.value.name, 'Keep my draft');
  assert.equal(ui.saves.length, 0);
});

test('Escape discards the active draft', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.habit.value.name = 'Discard me';
  ui.ctx.cancel({ preventDefault() {} });
  ui.ctx.closed();
  await ui.exposed.open();
  await ui.ctx.save();
  assert.equal(ui.saves[0].habits[0].name, 'Flute');
});

test('adding, reordering, archiving, and restoring use stable IDs', async () => {
  const ui = makeEditor();
  await ui.exposed.open();
  ui.ctx.addType.value = 'timer';
  ui.ctx.newHabit();
  const id = ui.ctx.habit.value.id;
  ui.ctx.moveHabit(ui.ctx.habit.value, -1);
  assert.equal(ui.ctx.activeHabits.value[0].id, id);
  ui.ctx.archiveHabit(ui.ctx.habit.value);
  assert.equal(ui.ctx.archivedHabits.value[0].id, id);
  ui.ctx.restoreHabit(ui.ctx.archivedHabits.value[0]);
  assert.equal(ui.ctx.habit.value.id, id);
  await ui.ctx.save();
  assert.equal(ui.saves[0].habits[0].id, id);
  assert.equal(ui.saves[0].habits[0].archived, false);
});
