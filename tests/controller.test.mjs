import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick } from 'vue'
import M from '../shared/tracker-model.mjs'
import { useTracker } from '../app/composables/useTracker.js'

const renderer=createRenderer({
  createElement:()=>({}), createText:()=>({}), createComment:()=>({}),
  insert(){},remove(){},setText(){},setElementText(){},patchProp(){},
  parentNode:()=>null,nextSibling:()=>null
})
function harness(t,initial=M.createDefaultData(),options={}){
  const storage=options.storage || (options.empty ? new Map() : new Map([[M.STORAGE_KEY,JSON.stringify(initial)]]))
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(options.fail)throw Error('Storage full');storage.set(key,value)},removeItem:key=>storage.delete(key)}
  globalThis.document={addEventListener(){},removeEventListener(){},hidden:false}
  globalThis.window={addEventListener(){},removeEventListener(){}}
  globalThis.confirm=()=>true
  let controller
  const mounted=renderer.createApp({setup(){controller=useTracker();return()=>null}})
  mounted.mount({})
  t.after(()=>mounted.unmount())
  return {controller,storage}
}
function sample(type='check'){
  const data=M.createDefaultData(); const habit=M.createHabit(type)
  habit.id='habit';habit.name='My activity';data.habits=[habit]
  return data
}

test('a new browser opens the personal holiday routine instead of a generic empty tracker', t => {
  const {controller:c,storage}=harness(t,undefined,{empty:true})
  assert.equal(c.data.value.challenge.name,'16-Day Holiday Habit Tracker')
  assert.equal(c.data.value.challenge.startDate,'2026-09-27')
  assert.equal(c.data.value.challenge.days,16)
  assert.equal(c.data.value.habits.find(h=>h.id==='flute').items.length,5)
  assert.equal(c.data.value.habits.find(h=>h.id==='piano').items.length,4)
  assert.equal(c.data.value.habits.find(h=>h.id==='bendDown').type,'check')
  assert.equal(c.data.value.habits.find(h=>h.id==='myobrace').target,7200)
  assert.equal(JSON.parse(storage.get(M.STORAGE_KEY)).challenge.days,16)
})

test('the previous empty generic default upgrades once while preserving appearance and a recovery copy', t => {
  const previous=M.createDefaultData()
  previous.preferences.background='peach-sky'
  previous.preferences.accent='#123456'
  const {controller:c,storage}=harness(t,previous)
  assert.equal(c.data.value.challenge.name,'16-Day Holiday Habit Tracker')
  assert.equal(c.data.value.preferences.background,'peach-sky')
  assert.equal(c.data.value.preferences.accent,'#123456')
  assert.deepEqual(JSON.parse(storage.get(`${M.STORAGE_KEY}_before_personal_default`)),previous)
  assert.equal(storage.get(`${M.STORAGE_KEY}_personal_default`),'1')
})

test('intentional custom configuration survives future visits after the default upgrade', t => {
  const custom=M.createDefaultData()
  const storage=new Map([[M.STORAGE_KEY,JSON.stringify(custom)],[`${M.STORAGE_KEY}_personal_default`,'1']])
  const {controller:c}=harness(t,custom,{storage})
  assert.equal(c.data.value.habits.length,0)
  assert.equal(c.data.value.challenge.name,'My Habit Tracker')
})

test('saving an old editor draft preserves new progress, latest appearance, and stable habit IDs',async t=>{
  const {controller:c,storage}=harness(t,sample('checklist'))
  const draft=JSON.parse(JSON.stringify(c.data.value))
  const item=draft.habits[0].items[0]
  c.action({name:'item',habitId:'habit',itemId:item.id,value:true})
  c.updatePreferences({accent:'#123456',compact:true})
  draft.habits[0].name='Renamed activity';draft.habits[0].items[0].label='Renamed step'
  c.saveConfiguration(draft)
  assert.equal(c.data.value.progress[c.selectedDate.value].habit.items[item.id],true)
  assert.equal(c.data.value.preferences.accent,'#123456')
  assert.equal(c.data.value.preferences.compact,true)
  assert.equal(c.data.value.habits[0].id,'habit')
  assert.equal(JSON.parse(storage.get(M.STORAGE_KEY)).habits[0].name,'Renamed activity')
  await nextTick()
})
test('changing dates and archiving habits keeps old progress for later restoration',t=>{
  const {controller:c}=harness(t,sample())
  c.action({name:'check',habitId:'habit',value:true})
  const original=c.selectedDate.value
  const draft=JSON.parse(JSON.stringify(c.data.value))
  draft.challenge.startDate='2030-01-01';draft.challenge.days=30;draft.habits[0].archived=true
  c.saveConfiguration(draft)
  assert.equal(c.data.value.progress[original].habit.done,true)
  assert.equal(c.summary.value.total,0)
  draft.challenge.startDate=original;draft.habits[0].archived=false;c.saveConfiguration(draft)
  assert.equal(c.data.value.progress[original].habit.done,true)
  assert.ok(c.summary.value.completed>=1)
})
test('changing a checkbox to a timer starts a real session; editing its duration preserves a running deadline',t=>{
  const {controller:c}=harness(t,sample())
  c.action({name:'check',habitId:'habit',value:true})
  const draft=JSON.parse(JSON.stringify(c.data.value));draft.habits[0].type='timer';draft.habits[0].target=1800
  c.saveConfiguration(draft)
  let entry=c.data.value.progress[c.selectedDate.value].habit
  assert.equal(entry.timer.remaining,1800);assert.equal(entry.done,false)
  c.action({name:'start',habitId:'habit'})
  const deadline=c.data.value.progress[c.selectedDate.value].habit.timer.endsAt
  draft.habits[0].target=3600;c.saveConfiguration(draft)
  entry=c.data.value.progress[c.selectedDate.value].habit
  assert.equal(entry.timer.endsAt,deadline);assert.equal(entry.timer.duration,1800)
  c.action({name:'reset-timer',habitId:'habit'})
  assert.equal(c.data.value.progress[c.selectedDate.value].habit.timer.remaining,3600)
})
test('counter targets, custom messages, focus view, and preferences remain functional',t=>{
  const initial=sample('counter');initial.habits[0].target=2.5;initial.habits[0].unit='km';initial.habits[0].messages=['{habit}: {target} {unit}!']
  const {controller:c}=harness(t,initial)
  c.action({name:'count',habitId:'habit',value:2.5})
  assert.equal(c.stats.value.completed,1)
  assert.equal(c.motivation.value.message,'My activity: 2.5 km!')
  c.updatePreferences({focus:true,celebrations:false,background:'custom',customColors:['#112233','#445566','#778899']})
  assert.equal(c.cards.value.length,0)
  c.action({name:'count',habitId:'habit',value:1.5})
  assert.equal(c.cards.value.length,1)
  c.action({name:'count',habitId:'habit',value:-5})
  assert.equal(c.data.value.progress[c.selectedDate.value].habit.count,1.5)
})
test('failed saves do not replace existing progress or configuration',t=>{
  const options={fail:false};const {controller:c,storage}=harness(t,sample(),options)
  const stored=storage.get(M.STORAGE_KEY)
  options.fail=true
  assert.equal(c.updatePreferences({compact:true}),false)
  assert.equal(c.data.value.preferences.compact,false)
  const draft=JSON.parse(JSON.stringify(c.data.value));draft.challenge.name='Should not save'
  assert.throws(()=>c.saveConfiguration(draft),/Storage full/)
  assert.notEqual(c.data.value.challenge.name,'Should not save')
  assert.equal(storage.get(M.STORAGE_KEY),stored)
})
test('a timer completes after switching dates without resetting its background deadline',t=>{
  const {controller:c}=harness(t,sample('timer'))
  const original=c.selectedDate.value
  c.action({name:'start',habitId:'habit'})
  const deadline=c.data.value.progress[original].habit.timer.endsAt
  c.selectDay(c.days.value[1].key)
  assert.equal(c.data.value.progress[original].habit.timer.endsAt,deadline)
  c.data.value.progress[original].habit.timer.endsAt=Date.now()-1000
  c.selectDay(c.days.value[2].key)
  assert.equal(c.data.value.progress[original].habit.done,true)
  assert.equal(c.data.value.progress[original].habit.timer.running,false)
})
