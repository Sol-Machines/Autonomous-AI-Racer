(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var btnScan = $("btn-scan");
  var scanResults = $("scan-results");
  var carConnectedInfo = $("car-connected-info");
  var connectedCarName = $("connected-car-name");
  var btnDisconnect = $("btn-disconnect-car");
  var carStatusDot = $("car-status-dot");
  var batteryDisplay = $("battery-display");
  var errorBanner = $("error-banner");
  var driveHud = $("drive-hud");
  var btnVoStart = $("btn-vo-start");
  var btnVoStop = $("btn-vo-stop");
  var voText = $("vo-text");
  var voStatusDot = $("vo-status-dot");
  var raceText = $("race-text");

  var carConnected = false;
  var control = { forward: 0, reverse: 0, left: 0, right: 0, lights: 0, turbo: 0, donut: 0 };

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }
  function showError(msg) { errorBanner.textContent = msg; show(errorBanner); setTimeout(function () { hide(errorBanner); }, 5000); }

  async function api(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    var resp = await fetch(path, opts);
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    return data;
  }

  // ---- Status polling ----
  async function poll() {
    try {
      var s = await api("GET", "/car/status");
      carConnected = s.connected;
      carStatusDot.className = "status-dot " + (s.connected ? "dot-on" : "dot-off");
      if (s.connected) {
        hide(btnScan); hide(scanResults); show(carConnectedInfo); show(driveHud);
        connectedCarName.textContent = s.name || "Car";
        if (s.battery != null) { batteryDisplay.textContent = s.battery + "%"; show(batteryDisplay); }
      } else {
        show(btnScan); hide(carConnectedInfo); hide(driveHud); hide(batteryDisplay);
      }
    } catch (e) {}

    try {
      var vo = await api("GET", "/slam/status");
      voStatusDot.className = "status-dot " + (vo.running ? "dot-on" : "dot-off");
      voText.textContent = vo.running
        ? "FPS: " + vo.fps.toFixed(0) + "  Conf: " + (vo.confidence * 100).toFixed(0) + "%  Frames: " + vo.frame_count
        : "Stopped";
    } catch (e) {}

    try {
      var race = await api("GET", "/track/race-status");
      raceText.textContent = race.racing
        ? "RACING  Laps: " + race.lap_count
        : race.emergency_stopped
          ? "STOPPED: " + race.stop_reason
          : "Idle";
    } catch (e) {}
  }

  setInterval(poll, 1500);
  poll();

  // ---- Car scan / connect ----
  btnScan.addEventListener("click", async function () {
    btnScan.textContent = "Scanning..."; btnScan.disabled = true;
    try {
      var data = await api("POST", "/car/scan");
      if (!data.cars.length) { scanResults.innerHTML = '<p class="no-cars">No cars found</p>'; }
      else {
        scanResults.innerHTML = data.cars.map(function (c) {
          return '<button class="btn btn-sm btn-green scan-car-btn" data-num="' + c.number + '">' + c.number + '. ' + c.name + '</button>';
        }).join("");
        scanResults.querySelectorAll(".scan-car-btn").forEach(function (b) {
          b.addEventListener("click", function () { connectCar(parseInt(b.dataset.num)); });
        });
      }
      show(scanResults);
    } catch (e) { showError(e.message); }
    finally { btnScan.textContent = "Scan for Cars"; btnScan.disabled = false; }
  });

  async function connectCar(num) {
    try { await api("POST", "/car/connect/" + num); poll(); } catch (e) { showError(e.message); }
  }

  btnDisconnect.addEventListener("click", async function () {
    try { await api("POST", "/car/disconnect"); poll(); } catch (e) { showError(e.message); }
  });

  // ---- VO controls ----
  btnVoStart.addEventListener("click", async function () {
    try { await api("POST", "/slam/start"); } catch (e) { showError(e.message); }
  });
  btnVoStop.addEventListener("click", async function () {
    try { await api("POST", "/slam/stop"); } catch (e) { showError(e.message); }
  });

  // ---- Keyboard driving ----
  async function sendControl() {
    if (!carConnected) return;
    try { await api("POST", "/car/control", control); } catch (e) {}
  }

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    var map = { w: "forward", s: "reverse", a: "left", d: "right" };
    var f = map[e.key.toLowerCase()];
    if (f) { control[f] = 1; sendControl(); var el = $("key-" + e.key.toLowerCase()); if (el) el.classList.add("active"); }
  });
  document.addEventListener("keyup", function (e) {
    var map = { w: "forward", s: "reverse", a: "left", d: "right" };
    var f = map[e.key.toLowerCase()];
    if (f) { control[f] = 0; sendControl(); var el = $("key-" + e.key.toLowerCase()); if (el) el.classList.remove("active"); }
  });

  document.querySelectorAll(".key").forEach(function (el) {
    var key = el.dataset.key;
    el.addEventListener("mousedown", function (e) { e.preventDefault(); control[{ w: "forward", s: "reverse", a: "left", d: "right" }[key]] = 1; sendControl(); el.classList.add("active"); });
    el.addEventListener("mouseup", function (e) { e.preventDefault(); control[{ w: "forward", s: "reverse", a: "left", d: "right" }[key]] = 0; sendControl(); el.classList.remove("active"); });
    el.addEventListener("mouseleave", function () { if (el.classList.contains("active")) { control[{ w: "forward", s: "reverse", a: "left", d: "right" }[key]] = 0; sendControl(); el.classList.remove("active"); } });
  });
})();
