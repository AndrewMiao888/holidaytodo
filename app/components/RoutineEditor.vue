<script setup>
import { computed, nextTick, ref } from 'vue'
import Model from '../../shared/tracker-model.mjs'

const props = defineProps({
  data: { type: Object, required: true },
  saveConfiguration: { type: Function, required: true }
})
const emit = defineEmits(['saved', 'close'])

const TYPES = { check: 'Simple checkbox', checklist: 'Checklist', counter: 'Number goal', timer: 'Timer' }
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const MAX_HABITS = 200
const dialog = ref(null)
const content = ref(null)
const draft = ref(null)
const selectedId = ref(null)
const activeTab = ref('routine')
const errorMessage = ref('')
const saving = ref(false)
const addType = ref('check')
const archivedOpen = ref(false)

const clone = value => JSON.parse(JSON.stringify(value))
const activeHabits = computed(() => draft.value?.habits.filter(habit => !habit.archived) || [])
const archivedHabits = computed(() => draft.value?.habits.filter(habit => habit.archived) || [])
const habit = computed(() => draft.value?.habits.find(entry => entry.id === selectedId.value))
const messageText = computed({
  get: () => habit.value?.messages.join('\n') || '',
  set: value => { if (habit.value) habit.value.messages = value.split('\n') }
})
const targetInput = computed({
  get() {
    if (!habit.value || !Number.isFinite(habit.value.target)) return ''
    return habit.value.type === 'timer' ? Number((habit.value.target / 60).toFixed(6)) : habit.value.target
  },
  set(value) {
    if (!habit.value) return
    habit.value.target = value === '' ? NaN : habit.value.type === 'timer' ? Math.round(Number(value) * 60) : Number(value)
  }
})

function validDate(value) {
  try { Model.parseDate(value); return true } catch { return false }
}

const challengeSummary = computed(() => {
  const challenge = draft.value?.challenge
  if (!challenge || !validDate(challenge.startDate) || !Number.isInteger(challenge.days) || challenge.days < 1 || challenge.days > 366) {
    return 'Choose a start date and a duration of 1–366 days.'
  }
  const end = Model.parseDate(challenge.startDate)
  end.setDate(end.getDate() + challenge.days - 1)
  return `${challenge.days} ${challenge.days === 1 ? 'day' : 'days'}, ending ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`
})

const messagePreview = computed(() => {
  if (!habit.value) return ''
  const current = habit.value
  const message = current.messages.find(line => line.trim())
  if (!message) return 'Leave this blank to use automatic messages that match this habit.'
  const values = {
    habit: current.name || 'Your habit',
    item: current.items[0]?.label || 'Your step',
    target: current.type === 'timer' ? Number((current.target / 60).toFixed(2)) : current.target,
    unit: current.unit || (current.type === 'timer' ? 'minutes' : '')
  }
  return 'Preview: ' + message.replace(/\{(habit|item|target|unit)\}/g, (_, key) => values[key])
})

function scheduleSummary(current) {
  if (current.weekdays.length === 7) return 'Every day'
  if (!current.weekdays.length) return 'Choose days'
  return DAY_ORDER.filter(day => current.weekdays.includes(day)).map(day => WEEKDAYS[day].slice(0, 3)).join(', ')
}

async function focusField(id) {
  await nextTick()
  const field = content.value?.querySelector('#' + id)
  field?.focus({ preventScroll: true })
  field?.scrollIntoView({ block: 'nearest' })
}

function selectHabit(current) {
  selectedId.value = current.id
  if (current.archived) archivedOpen.value = true
  errorMessage.value = ''
  focusField('editor-name')
}

function changeTab(tab) {
  activeTab.value = tab
  focusField('editor-tab-' + tab)
}

function navigateTabs(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  changeTab(event.key === 'Home' ? 'routine' : event.key === 'End' ? 'challenge' : activeTab.value === 'routine' ? 'challenge' : 'routine')
}

function newHabit() {
  if (draft.value.habits.length >= MAX_HABITS) return
  const current = Model.createHabit(addType.value)
  draft.value.habits.push(current)
  selectHabit(current)
}

function duplicateHabit(current) {
  if (draft.value.habits.length >= MAX_HABITS) return
  const duplicate = clone(current)
  duplicate.id = Model.uid()
  duplicate.name = current.name.slice(0, 93) + ' (copy)'
  duplicate.archived = false
  duplicate.items = duplicate.items.map(item => ({ id: Model.uid(), label: item.label }))
  draft.value.habits.splice(draft.value.habits.indexOf(current) + 1, 0, duplicate)
  selectHabit(duplicate)
}

function moveHabit(current, direction) {
  const other = activeHabits.value[activeHabits.value.indexOf(current) + direction]
  if (!other) return
  const index = draft.value.habits.indexOf(current)
  const otherIndex = draft.value.habits.indexOf(other)
  ;[draft.value.habits[index], draft.value.habits[otherIndex]] = [draft.value.habits[otherIndex], draft.value.habits[index]]
}

function archiveHabit(current) {
  current.archived = true
  if (selectedId.value === current.id) selectedId.value = activeHabits.value[0]?.id || null
  errorMessage.value = ''
}

function restoreHabit(current) {
  current.archived = false
  selectHabit(current)
}

function archiveAll() {
  if (!window.confirm('Start with an empty routine? Your current habits will be archived, with their progress kept. This change only takes effect when you save.')) return
  draft.value.habits.forEach(current => { current.archived = true })
  selectedId.value = null
  errorMessage.value = ''
}

function changeType(event) {
  const type = event.target.value
  const current = habit.value
  if (!TYPES[type] || type === current.type) return
  const unnamedItem = current.items.findIndex(item => !item.label.trim())
  if (current.type === 'checklist' && unnamedItem !== -1) {
    event.target.value = current.type
    errorMessage.value = 'Name every checklist step before changing its tracking style, or remove the empty step.'
    focusField('editor-item-' + unnamedItem)
    return
  }
  const defaults = Model.createHabit(type)
  current.type = type
  current.target = defaults.target
  current.unit = defaults.unit
  if (type === 'checklist' && !current.items.length) current.items = defaults.items
  errorMessage.value = ''
}

function addItem() {
  if (habit.value.items.length >= 100) return
  habit.value.items.push({ id: Model.uid(), label: '' })
  focusField('editor-item-' + (habit.value.items.length - 1))
}

function removeItem(index) {
  if (habit.value.items.length <= 1) return
  habit.value.items.splice(index, 1)
  focusField('editor-item-' + Math.min(index, habit.value.items.length - 1))
}

function moveItem(index, direction) {
  const items = habit.value.items
  const other = index + direction
  if (other < 0 || other >= items.length) return
  ;[items[index], items[other]] = [items[other], items[index]]
  focusField('editor-item-' + other)
}

function setSchedule(preset) {
  habit.value.weekdays = preset === 'weekdays' ? [1, 2, 3, 4, 5] : preset === 'weekend' ? [0, 6] : [0, 1, 2, 3, 4, 5, 6]
}

function validateDraft() {
  const current = draft.value
  current.challenge.name = current.challenge.name.trim()
  if (!current.challenge.name) return { message: 'Give your challenge a name.', tab: 'challenge', field: 'editor-challenge-name' }
  if (current.challenge.name.length > 100) return { message: 'Keep the challenge name to 100 characters or fewer.', tab: 'challenge', field: 'editor-challenge-name' }
  if (!validDate(current.challenge.startDate)) return { message: 'Choose a valid start date for your challenge.', tab: 'challenge', field: 'editor-start-date' }
  if (!Number.isInteger(current.challenge.days) || current.challenge.days < 1 || current.challenge.days > 366) return { message: 'Your challenge can run for 1–366 whole days.', tab: 'challenge', field: 'editor-days' }
  for (const entry of current.habits) {
    entry.name = entry.name.trim()
    entry.category = entry.category.trim()
    entry.unit = entry.unit.trim()
    entry.messages = entry.messages.map(line => line.trim()).filter(Boolean)
    const invalid = (message, field) => ({ message, habitId: entry.id, field: 'editor-' + field })
    if (!entry.name) return invalid('Every habit needs a name. Add a name to the selected habit.', 'name')
    if (!entry.weekdays.length) return invalid(`Choose at least one day for “${entry.name}”.`, 'schedule')
    if (entry.type === 'counter' && (!Number.isFinite(entry.target) || entry.target <= 0 || entry.target > 1e9)) return invalid(`Set a target above zero and no greater than 1,000,000,000 for “${entry.name}”.`, 'target')
    if (entry.type === 'timer' && (!Number.isInteger(entry.target) || entry.target < 1 || entry.target > 604800)) return invalid(`Set a timer goal between 1 second and 10,080 minutes for “${entry.name}”.`, 'target')
    if (entry.type === 'checklist') {
      if (!entry.items.length || entry.items.length > 100) return invalid(`“${entry.name}” needs between 1 and 100 checklist steps.`, 'name')
      for (let index = 0; index < entry.items.length; index++) {
        entry.items[index].label = entry.items[index].label.trim()
        if (!entry.items[index].label) return invalid(`Give step ${index + 1} in “${entry.name}” a name.`, 'item-' + index)
      }
    }
    if (entry.messages.length > 20) return invalid(`Use no more than 20 motivation messages for “${entry.name}”, one per line.`, 'messages')
    if (entry.messages.some(message => message.length > 500)) return invalid(`Keep each motivation message for “${entry.name}” to 500 characters or fewer.`, 'messages')
  }
  return null
}

async function save() {
  if (saving.value || !draft.value) return
  const issue = validateDraft()
  if (issue) {
    errorMessage.value = issue.message
    if (issue.tab) activeTab.value = issue.tab
    if (issue.habitId) {
      selectedId.value = issue.habitId
      activeTab.value = 'routine'
      archivedOpen.value = !!habit.value?.archived
    }
    focusField(issue.field)
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    const result = await props.saveConfiguration(clone(draft.value))
    if (result === false) {
      errorMessage.value = 'Your changes could not be saved. Review the settings, then try again.'
      return
    }
    close()
    emit('saved')
  } catch (error) {
    errorMessage.value = error?.message || 'Your changes could not be saved. Please try again.'
  } finally {
    saving.value = false
  }
}

async function open(habitId) {
  draft.value = clone(props.data)
  const requestedId = typeof habitId === 'string' ? habitId : habitId?.habitId
  selectedId.value = draft.value.habits.find(entry => entry.id === requestedId)?.id || activeHabits.value[0]?.id || null
  activeTab.value = habitId?.tab === 'challenge' ? 'challenge' : 'routine'
  errorMessage.value = ''
  addType.value = 'check'
  archivedOpen.value = !!habit.value?.archived
  await nextTick()
  if (!dialog.value.open) dialog.value.showModal()
}

function close() {
  if (dialog.value?.open) dialog.value.close()
  draft.value = null
  selectedId.value = null
}

function cancel(event) {
  if (saving.value) return event.preventDefault()
  draft.value = null
  selectedId.value = null
}

function closed() {
  draft.value = null
  selectedId.value = null
  emit('close')
}

defineExpose({ open, close })
</script>

<template>
  <dialog id="settings-dialog" ref="dialog" class="routine-editor-dialog" aria-labelledby="editor-title" @cancel="cancel" @close="closed">
    <div v-if="draft" id="settings-content" ref="content" class="stack editor-content">
      <div class="section-heading">
        <div><p class="muted small">MAKE IT YOURS</p><h2 id="editor-title">Customise your routine</h2></div>
        <button type="button" class="button" aria-label="Close routine editor" :disabled="saving" @click="close">✕</button>
      </div>
      <p class="muted">Build your own habits and goals. Your changes stay in this draft until you save.</p>
      <div class="editor-tabs row" role="tablist" aria-label="Routine settings" @keydown="navigateTabs">
        <button id="editor-tab-routine" type="button" class="button editor-tab" :class="{ active: activeTab === 'routine' }" role="tab" aria-controls="editor-tabpanel" :aria-selected="activeTab === 'routine'" :tabindex="activeTab === 'routine' ? 0 : -1" @click="changeTab('routine')">Habits &amp; goals</button>
        <button id="editor-tab-challenge" type="button" class="button editor-tab" :class="{ active: activeTab === 'challenge' }" role="tab" aria-controls="editor-tabpanel" :aria-selected="activeTab === 'challenge'" :tabindex="activeTab === 'challenge' ? 0 : -1" @click="changeTab('challenge')">Challenge</button>
      </div>

      <div id="editor-tabpanel" role="tabpanel" :aria-labelledby="'editor-tab-' + activeTab">
        <section v-if="activeTab === 'challenge'" class="panel stack" aria-label="Challenge settings">
          <div><h3>Your challenge</h3><p class="muted">Make the tracker fit your plans, whether that is a week, a holiday, or a whole year.</p></div>
          <label class="field"><span>Challenge name</span><input id="editor-challenge-name" v-model="draft.challenge.name" maxlength="100" required placeholder="My daily routine"></label>
          <div class="fields">
            <label class="field"><span>Start date</span><input id="editor-start-date" v-model="draft.challenge.startDate" type="date" required></label>
            <label class="field"><span>Number of days</span><input id="editor-days" v-model.number="draft.challenge.days" type="number" min="1" max="366" step="1" required></label>
          </div>
          <p class="muted small">{{ challengeSummary }}</p>
          <p class="muted small">Saved progress stays on its original dates when you change the challenge period.</p>
        </section>

        <div v-else class="editor-columns">
          <section class="panel stack editor-list-panel" aria-label="Routine habits">
            <div><h3>Your habits <span class="chip">{{ activeHabits.length }}</span></h3><p class="muted small">Choose a habit to edit its goal, schedule, and messages.</p></div>
            <div class="row editor-add-row">
              <label class="field editor-grow"><span class="small">New habit style</span><select v-model="addType"><option v-for="(label, type) in TYPES" :key="type" :value="type">{{ label }}</option></select></label>
              <button type="button" class="button primary" :disabled="draft.habits.length >= MAX_HABITS" @click="newHabit">+ Add habit</button>
            </div>
            <p v-if="draft.habits.length >= MAX_HABITS" class="muted small">This routine has reached the limit of 200 saved habits, including archived habits.</p>
            <div class="stack editor-habit-list">
              <div v-for="(entry, index) in activeHabits" :key="entry.id" class="habit-row editor-habit-row" :class="{ 'is-selected': selectedId === entry.id }">
                <button type="button" class="button editor-habit-select" :aria-pressed="selectedId === entry.id" @click="selectHabit(entry)">
                  <span aria-hidden="true">{{ entry.icon || '✨' }}</span><span class="editor-habit-label"><strong>{{ entry.name || 'Untitled habit' }}</strong><span class="muted small editor-habit-meta">{{ TYPES[entry.type] }} · {{ scheduleSummary(entry) }}</span></span>
                </button>
                <div class="row editor-row-actions">
                  <button type="button" class="button small" :disabled="index === 0" :aria-label="'Move ' + entry.name + ' up'" title="Move up" @click="moveHabit(entry, -1)">↑</button>
                  <button type="button" class="button small" :disabled="index === activeHabits.length - 1" :aria-label="'Move ' + entry.name + ' down'" title="Move down" @click="moveHabit(entry, 1)">↓</button>
                  <button type="button" class="button small" :disabled="draft.habits.length >= MAX_HABITS" :aria-label="'Duplicate ' + entry.name" @click="duplicateHabit(entry)">Duplicate</button>
                  <button type="button" class="button small" :aria-label="'Archive ' + entry.name" @click="archiveHabit(entry)">Archive</button>
                </div>
              </div>
              <p v-if="!activeHabits.length" class="muted">A fresh start. Add your first habit above, or restore an archived habit below.</p>
            </div>
            <details v-if="archivedHabits.length" class="editor-archived" :open="archivedOpen" @toggle="archivedOpen = $event.target.open">
              <summary>Archived habits ({{ archivedHabits.length }})</summary>
              <p class="muted small">Archived habits keep their saved progress. Restore them whenever you like.</p>
              <div class="stack editor-habit-list">
                <div v-for="entry in archivedHabits" :key="entry.id" class="habit-row editor-habit-row" :class="{ 'is-selected': selectedId === entry.id }">
                  <button type="button" class="button editor-habit-select" :aria-pressed="selectedId === entry.id" @click="selectHabit(entry)"><span aria-hidden="true">{{ entry.icon || '✨' }}</span><span class="editor-habit-label"><strong>{{ entry.name || 'Untitled habit' }}</strong><span class="muted small editor-habit-meta">{{ TYPES[entry.type] }} · {{ scheduleSummary(entry) }}</span></span></button>
                  <div class="row editor-row-actions"><button type="button" class="button small" :disabled="draft.habits.length >= MAX_HABITS" :aria-label="'Duplicate ' + entry.name" @click="duplicateHabit(entry)">Duplicate</button><button type="button" class="button small" :aria-label="'Restore ' + entry.name" @click="restoreHabit(entry)">Restore</button></div>
                </div>
              </div>
            </details>
            <div v-if="activeHabits.length"><button type="button" class="button danger small" @click="archiveAll">Start with an empty routine</button><p class="muted small">Moves your current habits into the archive. You can restore them later.</p></div>
          </section>

          <section v-if="habit" class="panel stack editor-detail" aria-labelledby="editor-detail-title">
            <div class="section-heading"><h3 id="editor-detail-title">Edit habit{{ habit.archived ? ' · archived' : '' }}</h3><span class="chip">{{ TYPES[habit.type] }}</span></div>
            <p v-if="habit.archived" class="muted">This habit is archived. You can still edit it, or restore it from the list.</p>
            <div class="fields">
              <label class="field"><span>Habit name</span><input id="editor-name" v-model="habit.name" maxlength="100" required placeholder="e.g. Flute practice"></label>
              <label class="field"><span>Icon or emoji</span><input v-model="habit.icon" maxlength="24" placeholder="e.g. 🎵"></label>
              <label class="field"><span>Category</span><input v-model="habit.category" maxlength="60" placeholder="e.g. Music, Movement, Learning"></label>
              <label class="field"><span>Card colour</span><input v-model="habit.color" type="color"></label>
            </div>
            <label class="field"><span>Notes or instructions</span><textarea v-model="habit.description" rows="2" maxlength="500" placeholder="Add reminders, instructions, or your reason for this habit."></textarea></label>
            <label class="field"><span>Tracking style</span><select id="editor-type" :value="habit.type" @change="changeType"><option v-for="(label, type) in TYPES" :key="type" :value="type">{{ label }}</option></select><span class="muted small">To keep an old setup intact, archive the habit and create a new one before changing its style.</span></label>

            <div v-if="habit.type === 'counter' || habit.type === 'timer'" class="fields">
              <label class="field"><span>{{ habit.type === 'timer' ? 'Daily timer goal (minutes)' : 'Daily target' }}</span><input id="editor-target" v-model="targetInput" type="number" :min="habit.type === 'timer' ? 1 / 60 : 0" :max="habit.type === 'timer' ? 10080 : 1000000000" step="any" required><span class="muted small">{{ habit.type === 'timer' ? 'For example, 30 for half an hour or 1.5 for 90 seconds.' : 'A count, distance, amount, or another number that matters to you.' }}</span></label>
              <label class="field"><span>{{ habit.type === 'timer' ? 'Unit for motivation messages' : 'Unit' }}</span><input v-model="habit.unit" maxlength="40" :placeholder="habit.type === 'timer' ? 'minutes' : 'e.g. questions, km, glasses'"><span v-if="habit.type === 'timer'" class="muted small">Leave blank to use “minutes”.</span></label>
            </div>

            <section v-if="habit.type === 'checklist'" class="stack" aria-label="Checklist steps">
              <div><h4>Checklist steps</h4><p class="muted small">Each step gets its own checkbox. Rename a step to keep its saved history.</p></div>
              <div v-for="(item, index) in habit.items" :key="item.id" class="row editor-checklist-row">
                <label class="field editor-grow"><span class="small">Step {{ index + 1 }}</span><input :id="'editor-item-' + index" v-model="item.label" maxlength="100" required placeholder="e.g. Scale 1"></label>
                <div class="row editor-step-actions">
                  <button type="button" class="button small" :disabled="index === 0" :aria-label="'Move step ' + (index + 1) + ' up'" @click="moveItem(index, -1)">↑</button>
                  <button type="button" class="button small" :disabled="index === habit.items.length - 1" :aria-label="'Move step ' + (index + 1) + ' down'" @click="moveItem(index, 1)">↓</button>
                  <button type="button" class="button danger small" :disabled="habit.items.length <= 1" :aria-label="'Remove step ' + (index + 1)" @click="removeItem(index)">Remove</button>
                </div>
              </div>
              <div><button type="button" class="button" :disabled="habit.items.length >= 100" @click="addItem">+ Add step</button></div>
              <p class="muted small">Removing a step hides its old checkmarks from this checklist.</p>
            </section>

            <fieldset id="editor-schedule" class="editor-schedule stack" tabindex="-1">
              <legend>Days to show this habit</legend>
              <div class="row"><button type="button" class="button small" @click="setSchedule('all')">Every day</button><button type="button" class="button small" @click="setSchedule('weekdays')">Weekdays</button><button type="button" class="button small" @click="setSchedule('weekend')">Weekend</button></div>
              <div class="weekday-grid"><label v-for="day in DAY_ORDER" :key="day" class="chip"><input v-model="habit.weekdays" type="checkbox" :value="day"><span>{{ WEEKDAYS[day].slice(0, 3) }}</span></label></div>
              <p class="muted small">Choose at least one day. Scheduled habits count toward that day's progress.</p>
            </fieldset>

            <label class="field"><span>Your motivation messages</span><textarea id="editor-messages" v-model="messageText" rows="4" maxlength="10019" placeholder="One message per line. Leave blank for a message matched to this habit."></textarea><span class="muted small">One message per line, up to 20 messages (500 characters each). Use {habit}, {item}, {target}, and {unit} to include the completed goal.</span></label>
            <p class="muted small editor-message-preview" aria-live="polite">{{ messagePreview }}</p>
          </section>
          <section v-else class="panel stack editor-empty"><span aria-hidden="true">✦</span><h3>A routine that fits you</h3><p class="muted">Create a habit with a checkbox, a list of steps, a number goal, or a timer. Then choose the days you want to do it.</p></section>
        </div>
      </div>

      <p v-if="errorMessage" id="editor-status" class="status" role="alert">{{ errorMessage }}</p>
      <div class="row editor-footer"><button type="button" class="button primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</button><button type="button" class="button" :disabled="saving" @click="close">Cancel</button><span class="muted small">Saved progress is kept.</span></div>
    </div>
  </dialog>
</template>

<style scoped>
.routine-editor-dialog { width: min(1180px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); }
.editor-content { min-width: 0; padding: 24px; }
.editor-columns { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.3fr); gap: 1rem; align-items: start; }
.editor-list-panel, .editor-detail { min-width: 0; }
.editor-habit-list { max-height: 32rem; overflow: auto; padding: 2px; }
.editor-habit-row { display: flex; flex-wrap: wrap; gap: .6rem; padding: .75rem; border: 1px solid var(--border, #d9d5e6); border-radius: 14px; }
.editor-habit-row.is-selected { border-color: var(--accent, #7c3aed); background: color-mix(in srgb, var(--accent, #7c3aed) 8%, transparent); }
.editor-habit-select { display: flex; flex: 1; align-items: center; gap: .6rem; padding: .2rem; min-width: 0; border: 0; background: transparent; color: var(--text); text-align: left; }
.editor-habit-label { min-width: 0; overflow-wrap: anywhere; }
.editor-habit-meta { display: block; margin-top: .2rem; font-weight: 400; }
.editor-row-actions { width: 100%; gap: .35rem; flex-wrap: wrap; }
.editor-add-row, .editor-checklist-row { align-items: end; }
.editor-grow { flex: 1; min-width: 120px; }
.editor-step-actions { gap: .3rem; }
.editor-schedule { min-width: 0; border: 1px solid var(--border, #d9d5e6); border-radius: 14px; padding: 1rem; }
.editor-schedule legend { padding: 0 .4rem; font-weight: 650; }
.editor-archived summary { cursor: pointer; padding: .4rem 0; font-weight: 650; }
.editor-message-preview { overflow-wrap: anywhere; }
.editor-footer { padding-top: 1rem; border-top: 1px solid var(--border, #d9d5e6); }
.editor-empty { text-align: center; padding: 3rem 1.5rem; }
.editor-empty > span { font-size: 2.5rem; color: var(--accent, #7c3aed); }
@media (max-width: 820px) { .editor-columns { grid-template-columns: 1fr; } .editor-habit-list { max-height: 20rem; } }
@media (max-width: 520px) { .routine-editor-dialog { width: calc(100vw - 1rem); max-height: calc(100dvh - 1rem); } .editor-checklist-row { flex-wrap: wrap; } .editor-step-actions { justify-content: flex-end; width: 100%; } }
</style>
