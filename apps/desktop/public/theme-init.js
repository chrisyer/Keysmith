try {
  var params = new URLSearchParams(window.location.search);
  var winKind = params.get('window');
  var m = document.querySelector('meta[name="color-scheme"]');
  var s = localStorage.getItem('color-scheme');
  var mode = s === 'light' || s === 'dark' ? s : 'system';
  var content = mode === 'system' ? 'light dark' : mode;
  if (m) {
    m.content = content;
  }
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = content;
  var isDark =
    mode === 'dark' ||
    (mode !== 'light' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  var bootBg =
    winKind === 'quick-access' || winKind === 'large-type' || winKind === 'generator'
      ? 'transparent'
      : isDark
        ? '#1c1c1e'
        : '#f2f2f5';
  var bootStyle = document.getElementById('ks-boot-bg');
  if (bootStyle) {
    bootStyle.textContent =
      'html, body { background-color: ' + bootBg + '; margin: 0; }';
  }
} catch (e) {}
