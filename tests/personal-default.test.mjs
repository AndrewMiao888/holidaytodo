import assert from 'node:assert/strict';
import test from 'node:test';
import Model from '../shared/tracker-model.mjs';
import { createPersonalData, adoptPersonalDefault } from '../shared/personal-default.mjs';

test('personal default restores the original calendar, stable IDs and checkbox totals', () => {
    const data = createPersonalData();
    assert.deepEqual(data.challenge, { name: '16-Day Holiday Habit Tracker', startDate: '2026-09-27', days: 16 });
    assert.equal(Model.calendar(data).at(-1).key, '2026-10-12');
    assert.deepEqual(data.habits.map(habit => habit.id), ['myobrace', 'exam', 'bendDown', 'jumpUp', 'run', 'flute', 'piano', 'shineEyes', 'vitamin', 'brushTeeth', 'probiotic']);
    assert.deepEqual(Model.getDayStats(data, '2026-09-27'), { completed: 0, total: 21, percentage: 0 });
    assert.deepEqual(Model.getDayStats(data, '2026-09-28'), { completed: 0, total: 23, percentage: 0 });
    assert.equal(Model.getSummary(data).total, 358);
    assert.deepEqual(Model.validateData(data), data);
});

test('personal goals have the original task labels, quantities, groups and schedules', () => {
    const data = createPersonalData();
    const byId = Object.fromEntries(data.habits.map(habit => [habit.id, habit]));
    assert.equal(byId.myobrace.type, 'timer');
    assert.equal(byId.myobrace.target, 7200);
    assert.equal(byId.myobrace.description, '2 hours of wear time');
    assert.deepEqual(byId.exam.items.map(item => item.label), ['Session 1 · 50 questions', 'Session 2 · 50 questions']);
    assert.deepEqual(byId.exam.weekdays, [1, 2, 3, 4, 5]);
    for (const [id, target, description] of [['bendDown', 20, '20 repetitions'], ['jumpUp', 40, '40 jumps'], ['run', 1, '1 km run']]) {
        assert.equal(byId[id].type, 'check');
        assert.equal(byId[id].target, target);
        assert.equal(byId[id].description, description);
    }
    assert.equal(byId.run.name, '1km Run');
    assert.deepEqual(byId.flute.items.map(item => item.label), ['Scale 1', 'Scale 2', 'Piece 1', 'Piece 2', 'Study 1']);
    assert.deepEqual(byId.piano.items.map(item => item.label), ['Piece 1', 'Piece 2', 'Piece 3', 'Piece 4']);
    assert.deepEqual(byId.shineEyes.items.map(item => item.label), ['Session 1', 'Session 2']);
    assert.deepEqual(byId.vitamin.items.map(item => item.label), ['Dose 1', 'Dose 2']);
    assert.deepEqual(byId.brushTeeth.items.map(item => item.label), ['Morning', 'Evening']);
    assert.deepEqual(byId.probiotic.items.map(item => item.label), ['Dose 1', 'Dose 2']);
    for (const habit of data.habits.filter(habit => habit.id !== 'exam')) assert.deepEqual(habit.weekdays, [0, 1, 2, 3, 4, 5, 6]);
});

test('fresh personal defaults have independent progress, items and automatic pastel preferences', () => {
    const first = createPersonalData();
    const second = createPersonalData();
    assert.equal(first.preferences.background, 'auto');
    assert.equal(first.preferences.mode, 'auto');
    assert.equal(first.preferences.celebrations, true);
    assert.deepEqual(first.preferences.customColors, ['#ffedd5', '#ddd6fe', '#bae6fd']);
    first.preferences.customColors[0] = '#000000';
    first.habits.find(habit => habit.id === 'flute').items[0].label = 'Changed';
    first.progress['2026-09-27'].flute.items.scale1 = true;
    first.progress['2026-09-27'].myobrace.timer.laps.push(1);
    assert.equal(second.preferences.customColors[0], '#ffedd5');
    assert.equal(second.habits.find(habit => habit.id === 'flute').items[0].label, 'Scale 1');
    assert.equal(second.progress['2026-09-27'].flute.items.scale1, false);
    assert.deepEqual(second.progress['2026-09-27'].myobrace.timer.laps, []);
});

test('adoption keeps every saved date, habit record and preference without mutating the source', () => {
    const saved = Model.createDefaultData(new Date(2030, 0, 1));
    const custom = Object.assign(Model.createHabit('checklist'), { id: 'other_habit' });
    saved.habits.push(custom);
    const old = Model.record(saved, '2020-01-01', custom);
    old.items.retired_item = true;
    old.count = 3;
    old.done = true;
    saved.preferences.background = 'custom';
    saved.preferences.customColors = ['#112233', '#445566', '#778899'];
    saved.preferences.celebrations = false;
    saved.preferences.focus = true;
    const before = JSON.stringify(saved);
    const adopted = adoptPersonalDefault(saved);
    assert.equal(adopted.challenge.startDate, '2026-09-27');
    assert.deepEqual(adopted.progress, saved.progress);
    assert.deepEqual(adopted.preferences, saved.preferences);
    assert.equal(JSON.stringify(saved), before);
    adopted.progress['2020-01-01'].other_habit.items.retired_item = false;
    adopted.preferences.customColors[0] = '#ffffff';
    assert.equal(saved.progress['2020-01-01'].other_habit.items.retired_item, true);
    assert.equal(saved.preferences.customColors[0], '#112233');
    assert.deepEqual(Model.validateData(adopted), adopted);
});

test('adoption converts reached counters using their saved targets and retains every field', () => {
    const saved = createPersonalData();
    for (const [id, target] of [['bendDown', 30], ['jumpUp', 2], ['run', 5]]) {
        Object.assign(saved.habits.find(habit => habit.id === id), { type: 'counter', target });
    }
    const day = saved.progress['2026-09-27'];
    day.bendDown.count = 20;
    day.jumpUp.count = 3;
    day.run.count = 5;
    day.run.items.retired = true;
    day.run.timer.laps = [1];
    saved.progress['2026-09-28'].bendDown.done = true;
    const before = JSON.stringify(saved);
    const adopted = adoptPersonalDefault(saved);
    assert.equal(adopted.progress['2026-09-27'].bendDown.done, false);
    assert.equal(adopted.progress['2026-09-27'].jumpUp.done, true);
    assert.equal(adopted.progress['2026-09-27'].run.done, true);
    assert.equal(adopted.progress['2026-09-28'].bendDown.done, true);
    assert.equal(adopted.progress['2026-09-27'].run.count, 5);
    assert.equal(adopted.progress['2026-09-27'].run.items.retired, true);
    assert.deepEqual(adopted.progress['2026-09-27'].run.timer.laps, [1]);
    assert.equal(JSON.stringify(saved), before);
    assert.equal(adopted.habits.find(habit => habit.id === 'bendDown').type, 'check');
    assert.equal(adopted.habits.find(habit => habit.id === 'bendDown').target, 20);
});

test('adoption preserves timer deadlines and checked goals, and rejects malformed saved data', () => {
    const saved = createPersonalData();
    const timer = saved.progress['2026-09-27'].myobrace.timer;
    timer.running = true;
    timer.endsAt = Date.now() + 60000;
    timer.remaining = 60;
    saved.progress['2026-09-27'].run.done = true;
    const adopted = adoptPersonalDefault(saved);
    assert.deepEqual(adopted.progress['2026-09-27'].myobrace.timer, timer);
    assert.equal(adopted.progress['2026-09-27'].run.done, true);
    assert.throws(() => adoptPersonalDefault({ version: 5 }));
});
