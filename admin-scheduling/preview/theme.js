/* Apply before paint; theme preference is independent of schedule data. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem('scheduling-theme'); } catch {}
  const apply = dark => {
    root.dataset.theme = dark ? 'dark' : 'light';
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
  };
  apply(saved ? saved === 'dark' : preference.matches);
  preference.addEventListener('change', e => { if (!saved) apply(e.matches); });
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme === 'dark');
    document.getElementById('theme-toggle').addEventListener('click', () => {
      saved = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(saved === 'dark');
      try { localStorage.setItem('scheduling-theme', saved); } catch {}
    });
  });
})();
