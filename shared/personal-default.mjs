import Model from './tracker-model.mjs';

function blankLegacyDay() {
    return {
        myobrace: false, myobraceSecondsLeft: 7200, myobraceRunning: false,
        myobraceEndsAt: null, myobraceLaps: [],
        exam1: false, exam2: false, bendDown: false, jumpUp: false, run: false,
        flute: Array(5).fill(false), piano: Array(4).fill(false),
        shineEyes1: false, shineEyes2: false, vitamin1: false, vitamin2: false,
        brushTeeth1: false, brushTeeth2: false, probiotic1: false, probiotic2: false
    };
}

function createPersonalData() {
    const legacy = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 1, blankLegacyDay()]));
    const data = Model.migrateLegacy(legacy);
    data.challenge.name = '16-Day Holiday Habit Tracker';
    const descriptions = { bendDown: '20 repetitions', jumpUp: '40 jumps', run: '1 km run' };
    for (const habit of data.habits) {
        if (Object.prototype.hasOwnProperty.call(descriptions, habit.id)) {
            habit.type = 'check';
            habit.description = descriptions[habit.id];
        }
    }
    data.habits.find(habit => habit.id === 'run').name = '1km Run';
    return data;
}

// The caller chooses when to adopt this routine; saved custom configurations are
// never switched automatically by this module.
function adoptPersonalDefault(existing) {
    const saved = Model.validateData(existing);
    const personal = createPersonalData();
    personal.progress = saved.progress;
    personal.preferences = saved.preferences;
    const previousCounters = saved.habits.filter(habit =>
        ['bendDown', 'jumpUp', 'run'].includes(habit.id) && habit.type === 'counter');
    for (const day of Object.values(personal.progress)) {
        for (const habit of previousCounters) {
            if (Object.prototype.hasOwnProperty.call(day, habit.id) && day[habit.id].count >= habit.target) {
                day[habit.id].done = true;
            }
        }
    }
    return personal;
}

export { createPersonalData, adoptPersonalDefault };
