// Upgrade the old built-in messages without overwriting messages someone wrote.
const legacyMessages = new Set([
  '{habit} goal complete! Well done for sticking with your wear-time routine.',
  '{habit}: {item} complete! Be proud of the focus you brought to studying.',
  '{habit}: {target} {unit} complete! Great commitment to your exercise routine.',
  '{habit}: {target} {unit} complete! Great energy and effort.',
  '{habit}: {target} {unit} complete! Every step counted toward your goal.',
  '{habit}: {item} complete! Well done for making time to practise.',
  '{habit}: {item} complete! Keep building your rhythm and expression.'
])

export function goalMessagesFor(habit, item = '') {
  if (habit.messages.length && !habit.messages.every(message => legacyMessages.has(message))) return habit.messages
  const name = habit.name
  const goal = item ? `${name} · ${item}` : name
  const quantity = `${habit.target} ${habit.unit}`.trim()
  if (habit.id === 'flute' && item) {
    const focus = /^scale/i.test(item) ? 'notes and fingering' : /^study/i.test(item) ? 'flute technique' : 'phrasing and expression'
    return [`${goal} complete! Well done for taking the time to work on your ${focus}.`, `You practised ${goal}! That took focus—give yourself credit for the work you put into your music.`]
  }
  if (habit.id === 'piano' && item) return [`${goal} complete! Well done for sitting down at the keys and putting in the practice.`, `You finished practising ${goal}! Keep bringing that care to your rhythm and expression.`]
  if (habit.id === 'exam' && item) return [`${goal} complete! That's a solid study session—well done for sticking with those questions.`, `You finished ${goal}! Take a moment to feel proud of the effort you put into learning.`]
  if (habit.type === 'timer') {
    const duration = habit.target % 3600 === 0 ? `${habit.target / 3600} ${habit.target === 3600 ? 'hour' : 'hours'}` : `${Number((habit.target / 60).toFixed(2))} minutes`
    return [`${name}: ${duration} complete! Well done for sticking with your goal all the way through.`, `You completed ${duration} of ${name}! That took patience and commitment—you've earned a moment to feel proud.`]
  }
  if (['bendDown', 'jumpUp', 'run'].includes(habit.id) || habit.type === 'counter') return [`${name}: ${quantity} complete! You showed up and reached your target—well done.`, `You reached your ${name} goal of ${quantity}! Give yourself credit for following through today.`]
  if (habit.id === 'brushTeeth') return [`${goal} complete! Nice work making time to look after your smile.`, `You finished ${goal}! Well done for keeping up your brushing routine.`]
  if (['vitamin', 'probiotic', 'shineEyes'].includes(habit.id)) return [`${goal} checked off! Well done for remembering this part of your routine.`, `You completed ${goal}! It's good to see you following through on the little daily tasks, too.`]
  return [`${goal} complete! Well done for making time for something you set out to do.`, `You finished ${goal}! Give yourself credit for the effort—that's another goal followed through.`]
}
