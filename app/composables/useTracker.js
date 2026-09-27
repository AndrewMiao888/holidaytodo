import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import M from '../../shared/tracker-model.mjs'
import themes from '../../shared/tracker-themes.mjs'
import { createPersonalData, adoptPersonalDefault } from '../../shared/personal-default.mjs'
import { goalMessagesFor } from '../../shared/goal-messages.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const PERSONAL_DEFAULT_KEY = `${M.STORAGE_KEY}_personal_default`
export const formatTime = seconds => [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), Math.floor(seconds % 60)].map(n => String(n).padStart(2, '0')).join(':')
export const isComplete = (habit, record) => habit.type === 'checklist' ? habit.items.every(item => record.items[item.id]) : habit.type === 'counter' ? record.count >= habit.target : record.done

export function useTracker() {
  const data = ref(createPersonalData())
  const loaded = ref(false)
  const storageError = ref('')
  const selectedDate = ref('')
  const today = ref(M.dateKey(new Date()))
  const notice = ref('')
  const motivation = ref(null)
  const days = computed(() => M.calendar(data.value))
  const selectedDay = computed(() => days.value.find(day => day.key === selectedDate.value) || days.value[0])
  const stats = computed(() => M.getDayStats(data.value, selectedDay.value.key))
  const summary = computed(() => M.getSummary(data.value))
  const todayDay = computed(() => days.value.find(day => day.key === today.value))
  const activeHabits = computed(() => data.value.habits.filter(h => !h.archived))
  const scheduledHabits = computed(() => activeHabits.value.filter(h => M.isScheduled(h, selectedDay.value.key)))
  const cards = computed(() => scheduledHabits.value.map(habit => ({ habit, record: M.record(data.value, selectedDay.value.key, habit) })).filter(({ habit, record }) => !data.value.preferences.focus || !isComplete(habit, record)))
  const quoteHistory = {}
  let timerInterval, themeInterval, noticeTimeout

  function notify(message) {
    notice.value = message
    clearTimeout(noticeTimeout)
    noticeTimeout = setTimeout(() => { notice.value = '' }, 6000)
  }
  function persist(candidate) {
    if (storageError.value) throw new Error('Restore a backup first. Your original saved copy has not been changed.')
    localStorage.setItem(M.STORAGE_KEY, JSON.stringify(candidate))
  }
  function commit(change) {
    try {
      const candidate = clone(data.value)
      change(candidate)
      const valid = M.validateData(candidate)
      persist(valid)
      data.value = valid
      return true
    } catch (error) { notify('Could not save: ' + error.message); return false }
  }
  function replaceData(candidate) {
    try {
      const valid = M.validateData(candidate)
      M.syncTimers(valid)
      localStorage.setItem(M.STORAGE_KEY, JSON.stringify(valid))
      data.value = valid
      storageError.value = ''
      chooseInitialDate()
      notify('Your setup and progress have been restored.')
      return true
    } catch (error) { notify('Could not restore: ' + error.message); return false }
  }
  function chooseInitialDate() {
    selectedDate.value = todayDay.value ? today.value : today.value < days.value[0].key ? days.value[0].key : days.value.at(-1).key
  }
  function saveConfiguration(draft) {
    const candidate = clone(data.value)
    M.syncTimers(candidate)
    const previous = new Map(candidate.habits.map(h => [h.id, h]))
    candidate.challenge = clone(draft.challenge)
    candidate.habits = clone(draft.habits)
    for (const habit of candidate.habits) {
      const old = previous.get(habit.id)
      if (!old) continue
      for (const day of Object.values(candidate.progress)) {
        const entry = day[habit.id]
        if (!entry) continue
        if (old.type === 'timer' && habit.type !== 'timer') { entry.timer.running = false; entry.timer.endsAt = null }
        if (habit.type === 'timer' && old.type !== 'timer') {
          entry.done = false
          entry.timer = { duration: habit.target, remaining: habit.target, endsAt: null, running: false, laps: [] }
        }
      }
    }
    const valid = M.validateData(candidate)
    persist(valid)
    data.value = valid
    if (!days.value.some(d => d.key === selectedDate.value)) chooseInitialDate()
    notify('Routine saved. Your existing progress stays with its dates and habits.')
    return true
  }
  function selectDay(key) {
    if (!days.value.some(d => d.key === key)) return
    tick()
    selectedDate.value = key
  }
  function goToToday() { if (todayDay.value) selectDay(today.value) }
  function updatePreferences(patch) { return commit(candidate => { Object.assign(candidate.preferences, patch) }) }

  function celebrate(habit, itemLabel = '') {
    if (!data.value.preferences.celebrations) return
    const key = habit.id + ':' + itemLabel
    const messages = goalMessagesFor(habit, itemLabel)
    const available = messages.filter(m => m !== quoteHistory[key])
    const choices = available.length ? available : messages
    const message = choices[Math.floor(Math.random() * choices.length)]
    quoteHistory[key] = message
    const values = { habit: habit.name, item: itemLabel || habit.name, itemSuffix: itemLabel ? ` · ${itemLabel}` : '', target: habit.type === 'timer' ? String(habit.target / 60) : String(habit.target), unit: habit.type === 'timer' ? 'minutes' : habit.unit }
    motivation.value = { title: itemLabel ? `${itemLabel} complete!` : `${habit.name} complete!`, message: message.replace(/\{(habit|item|itemSuffix|target|unit)\}/g, (_, name) => values[name]) }
  }
  function action({ name, habitId, itemId, value }) {
    tick()
    const habit = data.value.habits.find(h => h.id === habitId)
    if (!habit || !M.isScheduled(habit, selectedDate.value)) return
    const before = clone(M.record(data.value, selectedDate.value, habit))
    let item
    const ok = commit(candidate => {
      const entry = M.record(candidate, selectedDate.value, habit)
      const timer = entry.timer
      if (name === 'check') entry.done = Boolean(value)
      else if (name === 'item') {
        item = habit.items.find(i => i.id === itemId)
        if (!item) throw new Error('This checklist item has changed.')
        entry.items[itemId] = Boolean(value)
      } else if (['count','increase','decrease'].includes(name)) {
        const increment = Math.min(1, habit.target)
        const count = name === 'count' ? Number(value) : Math.round((entry.count + (name === 'increase' ? increment : -increment)) * 1e6) / 1e6
        if (!Number.isFinite(count) || count > M.LIMITS.counter || name === 'count' && (String(value).trim() === '' || count < 0)) throw new Error('Enter a valid nonnegative amount.')
        entry.count = Math.max(0, count)
      } else if (name === 'start' && !entry.done && !timer.running) {
        timer.running = true; timer.endsAt = Date.now() + timer.remaining * 1000
      } else if (name === 'pause') { timer.running = false; timer.endsAt = null }
      else if (name === 'lap' && timer.laps.length < M.LIMITS.laps) timer.laps.push(timer.duration - timer.remaining)
      else if (name === 'reset-timer' || name === 'timer-done') {
        entry.done = name === 'timer-done' && Boolean(value)
        entry.timer = { duration: habit.target, remaining: entry.done ? 0 : habit.target, endsAt: null, running: false, laps: [] }
      }
    })
    if (!ok) return
    const after = M.record(data.value, selectedDate.value, habit)
    if (item && !before.items[itemId] && after.items[itemId]) celebrate(habit, item.label)
    else if (!item && !isComplete(habit, before) && isComplete(habit, after)) celebrate(habit.type === 'timer' ? { ...habit, target: after.timer.duration } : habit)
  }
  function tick() {
    const completed = M.syncTimers(data.value)
    today.value = M.dateKey(new Date())
    if (!completed.length) return
    try { persist(data.value) } catch (error) { notify('Timer complete, but saving failed: ' + error.message) }
    const visible = completed.find(c => c.dateKey === selectedDate.value && data.value.habits.some(h => h.id === c.habitId && h.type === 'timer' && !h.archived))
    if (visible) celebrate({ ...data.value.habits.find(h => h.id === visible.habitId), target: data.value.progress[visible.dateKey][visible.habitId].timer.duration })
    else notify(`${completed.length} background timer${completed.length === 1 ? '' : 's'} completed.`)
  }
  function resetProgress() {
    if (!confirm('Clear progress and timers for the current challenge dates? Habits and appearance stay. Download a backup first to keep a copy.')) return
    if (commit(candidate => { for (const day of M.calendar(candidate)) delete candidate.progress[day.key] })) notify('Challenge progress reset.')
  }
  function addStarter(kind) {
    const specs = kind === 'study' ? [['Read','counter',20,'pages'],['Focus session','timer',1500,''],['Review notes','check',1,'']] : kind === 'movement' ? [['Walk','counter',20,'minutes'],['Stretch','timer',300,''],['Movement routine','check',1,'']] : [['Music practice','checklist',1,''],['Focused practice','timer',1200,'']]
    return commit(candidate => {
      for (const [name,type,target,unit] of specs) {
        const habit = M.createHabit(type)
        Object.assign(habit, { name,target,unit,category:kind[0].toUpperCase()+kind.slice(1) })
        if (type === 'checklist') habit.items = ['Warm-up','Technique','Piece'].map(label => ({ id:M.uid(), label }))
        candidate.habits.push(habit)
      }
    })
  }
  function brightness(hex) {
    const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
    return r*.2126+g*.7152+b*.0722
  }
  function applyAppearance() {
    if (!import.meta.client) return
    const p = data.value.preferences
    const preset = themes.find(item => item.id === p.background)
    const hour = new Date().getHours()
    let colors = preset?.colors || (hour >= 21 || hour < 5 ? ['#020617','#1e1b4b','#581c87'] : hour < 12 ? ['#fef3c7','#fecdd3','#ddd6fe'] : hour < 18 ? ['#ffedd5','#ddd6fe','#bae6fd'] : ['#fed7aa','#fbcfe8','#c4b5fd'])
    if (p.background === 'custom') colors = p.customColors
    const dark = preset ? preset.dark : p.background === 'custom' ? colors.reduce((sum,c)=>sum+brightness(c),0)/3<.4 : hour >=21||hour<5
    document.body.classList.toggle('dark', p.mode==='dark'||p.mode==='auto'&&dark)
    document.body.classList.toggle('compact', p.compact)
    document.body.classList.toggle('animations', p.animations)
    document.body.dataset.font=p.font
    document.body.style.backgroundImage=`linear-gradient(${p.gradientAngle}deg, ${colors.join(',')})`
    document.documentElement.style.setProperty('--accent',p.accent)
    document.documentElement.style.setProperty('--accent-text',brightness(p.accent)>.55?'#111827':'#fff')
  }
  function onVisibility() { if (!document.hidden) { tick(); applyAppearance() } }
  watch(() => data.value.preferences, applyAppearance, { deep:true })
  onMounted(() => {
    try {
      const saved=localStorage.getItem(M.STORAGE_KEY), legacy=localStorage.getItem('holiday_habit_tracker_v4')
      if (saved) {
        data.value=M.validateData(JSON.parse(saved))
        const wasEmptyDefault = data.value.challenge.name === 'My Habit Tracker' && data.value.habits.length === 0
        const wasMigratedRoutine = data.value.challenge.name === 'Holiday Habit Tracker' && data.value.challenge.startDate === '2026-09-27' && data.value.challenge.days === 16 && data.value.habits.length === 11 && data.value.habits.every(habit => ['myobrace','exam','bendDown','jumpUp','run','flute','piano','shineEyes','vitamin','brushTeeth','probiotic'].includes(habit.id))
        if (!localStorage.getItem(PERSONAL_DEFAULT_KEY) && (wasEmptyDefault || wasMigratedRoutine)) {
          const personal = adoptPersonalDefault(data.value)
          localStorage.setItem(`${M.STORAGE_KEY}_before_personal_default`, saved)
          persist(personal)
          data.value = personal
        }
      }
      else if (legacy) {
        data.value=adoptPersonalDefault(M.migrateLegacy(JSON.parse(legacy),localStorage.getItem('holiday_habit_tracker_background')||'auto',localStorage.getItem('holiday_habit_tracker_focus')==='true'))
        persist(data.value)
        notify('Your holiday routine and saved progress are ready.')
      }
      else persist(data.value)
      localStorage.setItem(PERSONAL_DEFAULT_KEY, '1')
    } catch (error) { storageError.value='Your saved tracker could not be loaded. It has not been overwritten. Restore a backup to continue. '+error.message }
    chooseInitialDate()
    tick(); applyAppearance(); loaded.value=true
    timerInterval=setInterval(tick,1000); themeInterval=setInterval(applyAppearance,60000)
    document.addEventListener('visibilitychange',onVisibility)
    window.addEventListener('pageshow',tick)
  })
  onUnmounted(() => {
    clearInterval(timerInterval); clearInterval(themeInterval); clearTimeout(noticeTimeout)
    document.removeEventListener('visibilitychange',onVisibility); window.removeEventListener('pageshow',tick)
  })
  return { data, loaded, storageError, selectedDate, selectedDay, days, stats, summary, today, todayDay, activeHabits, scheduledHabits, cards, notice, motivation, notify, replaceData, saveConfiguration, selectDay, goToToday, updatePreferences, action, resetProgress, addStarter }
}
