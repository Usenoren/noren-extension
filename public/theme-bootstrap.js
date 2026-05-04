try {
  var t = localStorage.getItem("noren:theme");
  var light = ["classic", "washi", "kumo"];
  if (t) {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("data-theme-mode", light.indexOf(t) >= 0 ? "light" : "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "kon");
    document.documentElement.setAttribute("data-theme-mode", "dark");
  }
} catch (e) {}
