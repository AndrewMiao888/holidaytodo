<script setup>
import { computed, ref } from 'vue'
import themes from '../../shared/tracker-themes.mjs'
const props=defineProps({preferences:Object})
const emit=defineEmits(['change'])
const panel=ref(null)
const selected=computed(()=>themes.find(t=>t.id===props.preferences.background)?.name || (props.preferences.background==='custom'?'Your gradient':'Automatic'))
function open(){panel.value.open=true;panel.value.scrollIntoView({block:'start'})}
function set(key,value){emit('change',{[key]:value})}
function setColor(index,value){const colors=[...props.preferences.customColors];colors[index]=value;emit('change',{customColors:colors,background:'custom'})}
defineExpose({open})
</script>

<template>
  <details ref="panel" class="panel">
    <summary>Make it look like you <span class="muted small">· {{ selected }}</span></summary>
    <div class="row"><button type="button" class="button small" :aria-pressed="preferences.background==='auto'" @click="set('background','auto')">Follow the time of day</button><span class="small muted">20 gradients, or mix your own below.</span></div>
    <div class="swatches" role="group" aria-label="Background gradients"><button v-for="theme in themes" :key="theme.id" type="button" class="swatch" :aria-pressed="preferences.background===theme.id" @click="set('background',theme.id)"><span class="swatch-preview" :style="{background:`linear-gradient(135deg,${theme.colors.join(',')})`}" aria-hidden="true"></span><span class="swatch-label">{{ theme.name }}{{ preferences.background===theme.id?' ✓':'' }}</span></button></div>
    <div class="fields">
      <fieldset class="field" style="margin:0;border:1px solid var(--border);border-radius:12px;padding:14px"><legend>Your own gradient</legend><div class="row"><label v-for="(color,index) in preferences.customColors" :key="index">{{ ['First','Middle','Last'][index] }} <input type="color" :value="color" :aria-label="`Gradient colour ${index+1}`" @input="setColor(index,$event.target.value)"></label></div><label>Direction · {{ preferences.gradientAngle }}°<input type="range" min="0" max="360" step="1" :value="preferences.gradientAngle" @input="set('gradientAngle',Number($event.target.value))"></label><button type="button" class="button small" :aria-pressed="preferences.background==='custom'" @click="set('background','custom')">Use my gradient</button></fieldset>
      <div class="stack"><label class="field">Accent colour<input type="color" :value="preferences.accent" @input="set('accent',$event.target.value)"></label><label class="field">Card colours<select :value="preferences.mode" @change="set('mode',$event.target.value)"><option value="auto">Automatic</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label class="field">Font<select :value="preferences.font" @change="set('font',$event.target.value)"><option value="inter">Inter</option><option value="system">System</option><option value="serif">Classic serif</option></select></label></div>
    </div>
    <div class="row" style="margin-top:20px"><label v-for="option in [['compact','Compact layout'],['animations','Animations'],['celebrations','Motivational popups']]" :key="option[0]" class="toggle-label"><input type="checkbox" :checked="preferences[option[0]]" @change="set(option[0],$event.target.checked)">{{ option[1] }}</label></div>
    <p class="small muted" style="margin-top:14px">Appearance changes save automatically on this browser.</p>
  </details>
</template>
