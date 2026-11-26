try {
  var params = new URLSearchParams(window.location.search);
  var winKind = params.get('window');
  var m = document.querySelector('meta[name="color-scheme"]');
  var s = localStorage.getItem('color-scheme');
  if (m && (s === 'light' || s === 'dark')) {
    m.content = s;
  }
  var isDark =
    s === 'dark' ||
    (s !== 'light' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  var bootBg =
    winKind === 'quick-access' || winKind === 'large-type'
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
