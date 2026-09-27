const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Vue = require('vue');
const SSR = require('@vue/server-renderer');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

// Render the real route/dashboard/card/editor templates. Only the browser-owned
// tracker lifecycle is replaced with deterministic reactive data for each state.
const root = path.join(__dirname, '..');
const factories = new Map();
let M, themes, createPersonalData, formatTime, isComplete, createBackup, parseBackup;
test.before(async () => {
  M = (await import('../shared/tracker-model.mjs')).default;
  themes = (await import('../shared/tracker-themes.mjs')).default;
  ({ createPersonalData } = await import('../shared/personal-default.mjs'));
  ({ formatTime, isComplete } = await import('../app/composables/useTracker.js'));
  ({ createBackup, parseBackup } = await import('../shared/tracker-backup.mjs'));
});

function transformImports(source) {
  return source
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue\/server-renderer['"];?/g, (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = SSR;`)
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = Vue;`)
    .replace(/^import .+ from ['"].+['"];?\s*$/gm, '');
}

function component(file, useTracker = () => fixture()) {
  if (!factories.has(file)) {
    const filename = path.join(root, file);
    const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(parsed.errors, [], `${file} parses`);
    const script = parsed.descriptor.scriptSetup || parsed.descriptor.script
      ? compileScript(parsed.descriptor, { id: file, genDefaultAs: 'Component' })
      : { content: 'const Component = {};', bindings: {} };
    const template = compileTemplate({
      id: file, filename, source: parsed.descriptor.template.content, ssr: true, ssrCssVars: [],
      compilerOptions: { bindingMetadata: script.bindings }
    });
    assert.deepEqual(template.errors, [], `${file} template compiles`);
    const code = transformImports(script.content) + '\n' + transformImports(template.code).replace('export function ssrRender', 'function ssrRender');
    factories.set(file, new Function('Vue', 'SSR', 'M', 'Model', 'themes', 'useTracker', 'useHead', 'formatTime', 'isComplete', 'createBackup', 'parseBackup', code + '\nComponent.ssrRender=ssrRender;return Component;'));
  }
  return factories.get(file)(Vue, SSR, M, M, themes, useTracker, () => {}, formatTime, isComplete, createBackup, parseBackup);
}

function fixture(state = 'populated') {
  const source = createPersonalData();
  if (state === 'empty') source.habits = [];
  if (state === 'rest') source.habits.forEach(habit => { habit.weekdays = []; });
  const data = Vue.ref(source);
  const days = Vue.computed(() => M.calendar(data.value));
  const selectedDate = Vue.ref(days.value[0].key);
  const selectedDay = Vue.computed(() => days.value.find(day => day.key === selectedDate.value));
  const today = Vue.ref(state === 'ended' ? '2099-01-01' : selectedDate.value);
  const todayDay = Vue.computed(() => days.value.find(day => day.key === today.value));
  const activeHabits = Vue.computed(() => data.value.habits.filter(habit => !habit.archived));
  const scheduledHabits = Vue.computed(() => activeHabits.value.filter(habit => M.isScheduled(habit, selectedDate.value)));
  if (state === 'complete') {
    data.value.preferences.focus = true;
    scheduledHabits.value.forEach(habit => {
      const entry = M.record(data.value, selectedDate.value, habit);
      entry.done = true;
      entry.count = habit.target;
      entry.timer.remaining = 0;
      habit.items.forEach(item => { entry.items[item.id] = true; });
    });
  }
  const cards = Vue.computed(() => scheduledHabits.value.map(habit => ({ habit, record: M.record(data.value, selectedDate.value, habit) })).filter(card => !data.value.preferences.focus || !isComplete(card.habit, card.record)));
  const calls = [];
  const callback = name => (...args) => { calls.push([name, ...args]); return true; };
  return {
    data, days, selectedDate, selectedDay, today, todayDay, activeHabits, scheduledHabits, cards, calls,
    loaded: Vue.ref(state !== 'loading'), storageError: Vue.ref(''), notice: Vue.ref(''), motivation: Vue.ref(null),
    stats: Vue.computed(() => M.getDayStats(data.value, selectedDate.value)),
    summary: Vue.computed(() => M.getSummary(data.value)),
    ...Object.fromEntries(['notify', 'replaceData', 'saveConfiguration', 'selectDay', 'goToToday', 'updatePreferences', 'action', 'resetProgress', 'addStarter'].map(name => [name, callback(name)]))
  };
}

async function renderRoute(route, state = 'populated') {
  const tracker = fixture(state);
  const Dashboard = component('app/components/TrackerDashboard.vue', () => tracker);
  const page = component(`app/pages/${route}.vue`);
  const app = Vue.createSSRApp(page);
  app.component('TrackerDashboard', Dashboard);
  app.component('HabitCard', component('app/components/HabitCard.vue'));
  app.component('AppearancePanel', component('app/components/AppearancePanel.vue'));
  app.component('RoutineEditor', component('app/components/RoutineEditor.vue'));
  return { html: await SSR.renderToString(app), tracker, Dashboard };
}

function assertPersonalOnly(html) {
  assert.doesNotMatch(html, /(?:href|to)=["'][^"']*\/custom\b/i, 'main route contains no link to /custom');
  assert.doesNotMatch(html, /Customise routine|Add or edit habits|Add my first habit|Edit schedule|aria-label="Edit\s|Study pack|Movement pack|Music pack/, 'editing controls stay absent');
  assert.doesNotMatch(html, /Make it look like you|Background gradients|type="(?:color|file)"|id="settings-dialog"/, 'settings, appearance, and import controls are not mounted');
  assert.doesNotMatch(html, /routine editor|starter pack|change the dates in/i, 'copy does not direct users to missing customization controls');
}

for (const state of ['populated', 'empty', 'rest', 'complete', 'ended', 'loading']) {
  test(`the / route hides customization in its ${state} state`, async () => {
    const { html } = await renderRoute('index', state);
    assertPersonalOnly(html);
    if (state === 'empty') assert.match(html, /No habits in this challenge/);
    if (state === 'rest') assert.match(html, /A rest day on your schedule/);
    if (state === 'complete') assert.match(html, /All done for Day/);
    if (state === 'ended') assert.match(html, /This challenge has ended/);
  });
}

test('personal route keeps the flute checkboxes and enabled timer controls', async () => {
  const { html } = await renderRoute('index');
  for (const label of ['Scale 1', 'Scale 2', 'Piece 1', 'Piece 2', 'Study 1']) assert.ok(html.includes(label));
  const taskCheckboxes = html.match(/<label\b[^>]*class="check-item[^>]*>\s*<input\b[^>]*type="checkbox"[^>]*>/g) || [];
  assert.ok(taskCheckboxes.length >= 5, 'actual task checkbox inputs are rendered');
  assert.ok(taskCheckboxes.every(input => !/\bdisabled\b/.test(input)), 'task inputs remain enabled');
  assert.match(html, /aria-label="Time remaining">02:00:00/);
  const start = html.match(/<button\b[^>]*>Start<\/button>/)?.[0];
  assert.ok(start, 'timer Start control is present');
  assert.doesNotMatch(start, /\bdisabled\b/, 'incomplete timer can still start');
  assert.match(html, />Reset timer<\/button>/);
});

test('/custom passes its flag through to full configuration controls', async () => {
  const { html } = await renderRoute('custom');
  for (const text of ['Customise routine', 'Appearance', '+ Add or edit habits', 'Make it look like you', 'Background gradients', 'Restore a backup']) assert.ok(html.includes(text), text);
  assert.match(html, /id="settings-dialog"/);
  assert.match(html, /aria-label="Edit Flute Practice"/);
  assert.match(html, /type="file"/);
  const { html: empty } = await renderRoute('custom', 'empty');
  assert.match(empty, /Add my first habit/);
  assert.match(empty, /Study pack/);
  const { html: rest } = await renderRoute('custom', 'rest');
  assert.match(rest, /Edit schedule/);
});

test('main route guards editor, starter, and restore actions as well as hiding controls', async () => {
  const tracker = fixture();
  const Dashboard = component('app/components/TrackerDashboard.vue', () => tracker);
  const ctx = Dashboard.setup({ customizable: false }, { expose() {} });
  const opened = [];
  ctx.editor.value = { open: id => opened.push(id) };
  ctx.openEditor('flute');
  ctx.starter('music');
  await ctx.restore(undefined);
  assert.deepEqual(opened, []);
  assert.equal(tracker.calls.length, 0);
});

test('read-only habit configuration leaves completion and timer action events active', () => {
  const data = createPersonalData();
  const Card = component('app/components/HabitCard.vue');
  const events = [];
  for (const [id, name, value, itemId] of [['flute', 'item', true, 'scale1'], ['myobrace', 'start', undefined, undefined]]) {
    const habit = data.habits.find(entry => entry.id === id);
    const record = M.record(data, data.challenge.startDate, habit);
    const ctx = Card.setup({ habit, record, focus: false, editable: false }, { expose() {}, emit: (...args) => events.push(args) });
    ctx.act(name, value, itemId);
  }
  assert.deepEqual(events, [
    ['action', { name: 'item', value: true, itemId: 'scale1', habitId: 'flute' }],
    ['action', { name: 'start', value: undefined, itemId: undefined, habitId: 'myobrace' }]
  ]);
});

test('app shell renders the Nuxt page outlet', async () => {
  const app = Vue.createSSRApp(component('app/app.vue'));
  app.component('NuxtPage', { render: () => Vue.h('main', { 'data-page-outlet': 'present' }) });
  assert.match(await SSR.renderToString(app), /data-page-outlet="present"/);
});
