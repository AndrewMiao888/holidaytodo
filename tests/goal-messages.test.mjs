import test from 'node:test'
import assert from 'node:assert/strict'
import { createPersonalData } from '../shared/personal-default.mjs'
import { goalMessagesFor } from '../shared/goal-messages.mjs'

test('every original goal receives varied congratulations naming its exact habit and step', () => {
  for (const habit of createPersonalData().habits) {
    for (const item of habit.type === 'checklist' ? habit.items : [{label:''}]) {
      const messages = goalMessagesFor(habit,item.label)
      assert.ok(messages.length >= 2)
      assert.equal(new Set(messages).size,messages.length)
      for (const message of messages) {
        assert.ok(message.includes(habit.name),habit.name)
        if (item.label) assert.ok(message.includes(item.label),item.label)
        assert.doesNotMatch(message,/\{\w+\}/)
      }
    }
  }
})
test('congratulations match flute technique, exercise amounts, exam sessions and timer duration', () => {
  const habits=createPersonalData().habits
  const find=id=>habits.find(h=>h.id===id)
  assert.match(goalMessagesFor(find('flute'),'Scale 1')[0],/notes and fingering/)
  assert.match(goalMessagesFor(find('flute'),'Study 1')[0],/flute technique/)
  assert.match(goalMessagesFor(find('flute'),'Piece 2')[0],/phrasing and expression/)
  assert.match(goalMessagesFor(find('bendDown'))[0],/20 repetitions/)
  assert.match(goalMessagesFor(find('jumpUp'))[0],/40 jumps/)
  assert.match(goalMessagesFor(find('myobrace'))[0],/2 hours/)
  assert.match(goalMessagesFor(find('exam'),find('exam').items[1].label)[0],/Session 2.*50 questions/)
})
test('user-written quotes are preserved while renamed goals use the current name and target', () => {
  const habit=createPersonalData().habits[0]
  habit.name='Reading';habit.target=1800
  assert.match(goalMessagesFor(habit)[0],/Reading: 30 minutes/)
  habit.messages=['My own message about {habit}.']
  assert.deepEqual(goalMessagesFor(habit),habit.messages)
})
