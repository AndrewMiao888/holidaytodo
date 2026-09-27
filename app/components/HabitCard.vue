<script setup>
import { computed } from 'vue'
import { formatTime, isComplete } from '../composables/useTracker.js'
const props = defineProps({ habit: Object, record: Object, focus: Boolean, editable: Boolean })
const emit = defineEmits(['action','edit'])
const complete = computed(() => isComplete(props.habit, props.record))
const items = computed(() => props.habit.items.filter(item => !props.focus || !props.record.items[item.id]))
function act(name, value, itemId) { emit('action', { name, value, itemId, habitId: props.habit.id }) }
</script>

<template>
  <article class="habit-card" :class="{complete,'timer-card':habit.type==='timer'}" :data-habit="habit.id" :style="{'--habit-color':habit.color}">
    <div class="habit-heading">
      <span class="icon" aria-hidden="true">{{ habit.icon || '✓' }}</span>
      <div class="copy"><h3>{{ habit.name }}</h3><span v-if="habit.category" class="chip">{{ habit.category }}</span><p v-if="habit.description" class="muted small">{{ habit.description }}</p></div>
      <button v-if="editable" type="button" class="button small" :aria-label="`Edit ${habit.name}`" @click="emit('edit',habit.id)">Edit</button>
    </div>
    <label v-if="habit.type==='check'" class="check-item" :class="{done:complete}"><input type="checkbox" :checked="record.done" @change="act('check',$event.target.checked)"><span>Mark complete</span></label>
    <div v-else-if="habit.type==='checklist'" class="habit-checklist">
      <label v-for="item in items" :key="item.id" class="check-item" :class="{done:record.items[item.id]}"><input type="checkbox" :checked="record.items[item.id]" @change="act('item',$event.target.checked,item.id)"><span>{{ item.label }}</span></label>
    </div>
    <template v-else-if="habit.type==='counter'">
      <div class="counter-value">{{ record.count }} <span class="small muted">/ {{ habit.target }} {{ habit.unit }}</span></div>
      <div class="counter-controls"><button type="button" class="button" :disabled="record.count<=0" :aria-label="`Decrease ${habit.name}`" @click="act('decrease')">−</button><input type="number" min="0" max="1000000000" step="any" :value="record.count" :aria-label="`${habit.name} amount`" @change="act('count',$event.target.value)"><button type="button" class="button" :aria-label="`Increase ${habit.name}`" @click="act('increase')">+</button></div>
    </template>
    <template v-else>
      <span class="timer-display" aria-label="Time remaining">{{ formatTime(record.timer.remaining) }}</span>
      <p class="timer-note">{{ record.timer.running ? 'Running · time is counted in the background.' : complete ? 'Session complete.' : 'Paused · ready when you are.' }}<template v-if="record.timer.duration!==habit.target"> This session: {{ formatTime(record.timer.duration) }}. Reset to use your new {{ formatTime(habit.target) }} target.</template></p>
      <div class="row"><button type="button" class="button primary small" :disabled="complete" @click="act(record.timer.running?'pause':'start')">{{ record.timer.running?'Pause':'Start' }}</button><button type="button" class="button small" :disabled="record.timer.duration===record.timer.remaining||record.timer.laps.length>=1000" @click="act('lap')">Lap</button><button type="button" class="button small" @click="act('reset-timer')">Reset timer</button><label class="toggle-label small"><input type="checkbox" :checked="record.done" @change="act('timer-done',$event.target.checked)">Complete</label></div>
      <details v-if="record.timer.laps.length" class="small muted" style="margin-top:12px"><summary>{{ record.timer.laps.length }} laps</summary><div v-for="(lap,index) in record.timer.laps" :key="index">Lap {{ index+1 }}: {{ formatTime(lap) }}</div></details>
    </template>
  </article>
</template>
