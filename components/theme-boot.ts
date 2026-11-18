/** Runs in <head> before React paints: applies a saved light/dark choice. Keep it tiny. */
export const THEME_KEY = 'aa-theme'
export const THEME_BOOT = `(function(){try{var m=localStorage.getItem('${THEME_KEY}');if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m)}catch(e){}})()`
