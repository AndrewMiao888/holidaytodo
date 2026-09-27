export default defineNuxtConfig({
  compatibilityDate: '2026-09-27',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/tracker.css'],
  app: {
    head: {
      title: '16-Day Holiday Habit Tracker',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'theme-color', content: '#7c3aed' }],
      link: [{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' }]
    }
  }
})
