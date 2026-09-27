<script setup>
import { ref, watch, nextTick } from 'vue'
import M from '../../shared/tracker-model.mjs'
import { createBackup, parseBackup } from '../../shared/tracker-backup.mjs'
import { useTracker } from '../composables/useTracker.js'
const props=defineProps({customizable:{type:Boolean,default:false}})
const {data,loaded,storageError,selectedDate,selectedDay,days,stats,summary,today,todayDay,activeHabits,scheduledHabits,cards,notice,motivation,notify,replaceData,saveConfiguration,selectDay,goToToday,updatePreferences,action,resetProgress,addStarter}=useTracker()
const editor=ref(null),appearance=ref(null),celebration=ref(null),navigation=ref(null)
const backupStatus=ref(''),backupError=ref(false),restoring=ref(false)
useHead({title:()=>data.value.challenge.name})
async function jump(key){selectDay(key);await nextTick();navigation.value?.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'center'})}
function openEditor(id){if(props.customizable)editor.value?.open(id)}
function starter(kind){if(props.customizable&&addStarter(kind))openEditor()}
watch(motivation,async value=>{await nextTick();if(value&&!celebration.value?.open)celebration.value?.showModal();else if(!value)celebration.value?.close()})
function downloadText(contents,name){const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function download(){
  try{const payload=createBackup(data.value);const contents=JSON.stringify(payload,null,2);if(new Blob([contents]).size>5*1024*1024)throw new Error('Backup exceeds the 5 MB limit.');downloadText(contents,`habit-tracker-${M.dateKey(new Date())}.json`);backupError.value=false;backupStatus.value='Backup download started. Your full setup and progress are included.'}
  catch(error){backupError.value=true;backupStatus.value='Could not create the backup. '+error.message}
}
async function restore(event){
  if(!props.customizable)return
  const input=event.target,file=input.files?.[0];if(!file||restoring.value)return
  restoring.value=true;backupError.value=false
  try{
    if(file.size===0||file.size>5*1024*1024)throw new Error('Choose a JSON backup between 1 byte and 5 MB.')
    backupStatus.value='Checking your backup…'
    const payload=JSON.parse(await file.text())
    const validated=parseBackup(payload,Date.now(),data.value.preferences.background)
    if(!confirm(`Restore “${validated.challenge.name}”? This replaces the current setup and progress. Download your current backup first if you want to keep it.`)){backupStatus.value='Restore cancelled. Your tracker is unchanged.';return}
    if(!replaceData(parseBackup(payload,Date.now(),data.value.preferences.background)))throw new Error('Your browser could not save it. Current progress has not been replaced.')
    backupStatus.value='Your challenge, habits, appearance, and progress are restored.'
  }catch(error){backupError.value=true;backupStatus.value='Could not restore the backup. '+error.message}
  finally{input.value='';restoring.value=false}
}
function recover(){const contents=localStorage.getItem(M.STORAGE_KEY)||localStorage.getItem('holiday_habit_tracker_v4');if(contents)downloadText(contents,'tracker-recovery.json');else notify('No saved recovery data was found.')}
</script>

<template>
  <div v-if="!loaded" class="app-shell"><section class="panel" role="status">Loading your tracker…</section></div>
  <div v-else class="app-shell" :class="{'personal-tracker':!customizable}">
    <header class="panel hero">
      <div class="hero-copy"><span class="eyebrow">{{ days.length }}-Day Challenge<span v-if="customizable"> · Customisation</span></span><h1>{{ data.challenge.name }}</h1><p class="muted">{{ days[0].label }}, {{ days[0].date.getFullYear() }} — {{ days.at(-1).label }}, {{ days.at(-1).date.getFullYear() }}</p></div>
      <div class="hero-actions"><button type="button" class="button danger" @click="resetProgress">Reset All</button><button v-if="customizable" type="button" class="button primary" @click="openEditor()">Customise routine</button><button type="button" class="button" @click="appearance.open()">Appearance</button></div>
    </header>
    <section v-if="storageError" class="panel status error" role="alert"><p>{{ storageError }}</p><button type="button" class="button" @click="recover">Download saved recovery data</button></section>
    <section class="panel" aria-label="Progress overview">
      <div class="section-heading"><div><h2>Your progress</h2><p class="small muted">{{ todayDay ? `Today is Day ${todayDay.dayNum} · ${todayDay.label}` : today &lt; days[0].key ? `Your challenge starts ${days[0].label}.` : 'This challenge has ended. You can still review every day.' }}</p></div><button type="button" class="button" :disabled="!todayDay" @click="goToToday">Go to today</button></div>
      <div class="stats"><div class="stat"><strong>{{ summary.total?Math.round(summary.completed/summary.total*100):0 }}%</strong><span>Overall completion</span></div><div class="stat"><strong>{{ summary.completed }}</strong><span>Tasks completed</span></div><div class="stat"><strong>{{ summary.daysCompleted }}/{{ days.length }}</strong><span>Days completed</span></div><div class="stat"><strong>{{ summary.bestStreak }} {{ summary.bestStreak===1?'day':'days' }}</strong><span title="Longest run of fully completed days; rest days break the streak">Best full-day streak</span></div></div>
    </section>
    <AppearancePanel ref="appearance" :preferences="data.preferences" @change="updatePreferences" />
    <nav ref="navigation" class="panel day-nav" aria-label="Challenge days"><button v-for="day in days" :key="day.key" type="button" class="day-tab" :aria-current="day.key===selectedDate?'page':undefined" :aria-label="`${day.label}${day.key===today?', today':''}`" @click="jump(day.key)"><strong>Day {{ day.dayNum }}{{ day.key===today?' · Today':'' }}</strong><span>{{ day.label }}</span><progress :value="M.getDayStats(data,day.key).completed" :max="M.getDayStats(data,day.key).total||1" aria-label="Daily completion"></progress></button></nav>
    <main class="panel" aria-label="Habits for selected day">
      <div class="section-heading"><div><h2>Day {{ selectedDay.dayNum }} · {{ selectedDay.label }}</h2><p class="muted small">{{ stats.total ? `${stats.completed}/${stats.total} tasks complete · ${stats.total-stats.completed} left` : 'No scheduled tasks' }}</p></div><button v-if="customizable" type="button" class="button small" @click="openEditor()">+ Add or edit habits</button></div>
      <div class="row spread toolbar"><label class="toggle-label"><input type="checkbox" :checked="data.preferences.focus" @change="updatePreferences({focus:$event.target.checked})">Focus view</label><span class="small muted">{{ data.preferences.focus?'Showing unfinished tasks':'Showing all scheduled tasks' }}</span></div>
      <div v-if="!activeHabits.length && customizable" class="empty"><span class="empty-icon" aria-hidden="true">✦</span><h3>Build a routine that fits your life</h3><p class="muted">Choose your habits, targets, dates, and style. Start from scratch or try a starter pack.</p><div class="row"><button type="button" class="button primary" @click="openEditor()">Add my first habit</button><button v-for="pack in ['study','movement','music']" :key="pack" type="button" class="button" @click="starter(pack)">{{ pack[0].toUpperCase()+pack.slice(1) }} pack</button></div></div>
      <div v-else-if="!activeHabits.length" class="empty"><h3>No habits in this challenge</h3><p class="muted">Your saved progress is still available in your backup.</p></div>
      <div v-else-if="!scheduledHabits.length" class="empty"><h3>A rest day on your schedule</h3><p class="muted">No habits are scheduled for {{ selectedDay.label }}. </p><button v-if="customizable" type="button" class="button" @click="openEditor()">Edit schedule</button></div>
      <div v-else-if="!cards.length" class="empty"><span class="empty-icon" aria-hidden="true">✓</span><h3>All done for Day {{ selectedDay.dayNum }}!</h3><p class="muted">Every scheduled task is complete.</p><button type="button" class="button" @click="updatePreferences({focus:false})">Show completed tasks</button></div>
      <div v-else class="habit-grid"><HabitCard v-for="card in cards" :key="card.habit.id+selectedDate" :habit="card.habit" :record="card.record" :focus="data.preferences.focus" :editable="customizable" @action="action" @edit="openEditor($event)" /></div>
    </main>
    <details class="panel"><summary>Backups &amp; progress</summary><p class="muted">Save a copy of your challenge and progress.</p><div class="row"><button type="button" class="button primary" @click="download">Download backup</button><label v-if="customizable" class="field">Restore a backup<input type="file" accept=".json,application/json" :disabled="restoring" @change="restore"></label></div><p role="status" class="status" :class="{error:backupError}">{{ backupStatus }}</p><hr style="border:0;border-top:1px solid var(--border);margin:22px 0"><div class="row spread"><span class="small muted">Clear progress for the current challenge dates while keeping your routine and appearance.</span><button type="button" class="button danger small" @click="resetProgress">Reset challenge progress</button></div></details>
    <p class="small muted" style="text-align:center">Saved in this browser. Use a backup to move your tracker to another device.</p>
    <RoutineEditor v-if="customizable" ref="editor" :data="data" :save-configuration="saveConfiguration" />
    <dialog ref="celebration" id="motivation-dialog" aria-labelledby="motivation-title" aria-describedby="motivation-message" @close="motivation=null"><span class="empty-icon" aria-hidden="true">✨</span><h2 id="motivation-title">{{ motivation?.title }}</h2><p id="motivation-message">{{ motivation?.message }}</p><button type="button" class="button primary" @click="motivation=null">Keep going</button></dialog>
    <div v-if="notice" id="app-status" role="status" class="status">{{ notice }}</div>
  </div>
</template>
