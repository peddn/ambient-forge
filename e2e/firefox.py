"""Prüft die wichtigsten Abläufe in Firefox über WebDriver.

    FIREFOX_ENV=/pfad/zur/conda-umgebung python3 e2e/firefox.py

Die Umgebung braucht firefox, geckodriver und pulseaudio. Der Test startet einen
eigenen Server und misst das Audiosignal wie e2e/run.cjs am Ausgang der Web Audio API.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import Select

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "e2e" / "media"
OUTPUT = ROOT / "e2e" / "output" / "firefox"
ENV = Path(os.environ["FIREFOX_ENV"])
BINARY = Path(os.environ.get("AMBIENT_FORGE_BINARY", ROOT / "target" / "release" / "ambient-forge"))
PORT = 18090
LOCAL = f"http://127.0.0.1:{PORT}"
AUDIBLE = 0.03
SILENT = 0.001

passed = 0
failures = []


def check(name, condition, detail=None):
    global passed
    if condition:
        passed += 1
        print(f"  ok    {name}", flush=True)
    else:
        failures.append(name)
        suffix = "" if detail is None else f": {detail}"
        print(f"  FEHLER {name}{suffix}", flush=True)


def until(probe, timeout=8.0, interval=0.05):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = probe()
        except Exception as error:  # noqa: BLE001 - der nächste Versuch entscheidet
            last = None
            failure = error
        if last:
            return last
        time.sleep(interval)
    return last


INSTRUMENT = """
window.__starts = [];
const start = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...args) {
  window.__starts.push({ at: Date.now(), loop: this.loop });
  return start.apply(this, args);
};
const connect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (target, ...rest) {
  const result = connect.call(this, target, ...rest);
  if (target instanceof AudioDestinationNode) {
    const context = this.context;
    if (!context.__tap) {
      const splitter = context.createChannelSplitter(2);
      const left = context.createAnalyser();
      const right = context.createAnalyser();
      connect.call(splitter, left, 0);
      connect.call(splitter, right, 1);
      context.__tap = { splitter, left, right };
      window.__tap = context.__tap;
      window.__context = context;
    }
    connect.call(this, context.__tap.splitter);
  }
  return result;
};
window.__level = () => {
  if (!window.__tap) return { left: 0, right: 0 };
  const rms = (analyser) => {
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  };
  return { left: rms(window.__tap.left), right: rms(window.__tap.right) };
};
window.__streams = [];
const OriginalAudio = window.Audio;
window.Audio = function (...args) {
  const element = new OriginalAudio(...args);
  window.__streams.push(element);
  return element;
};
"""


def prepare_web_dir(target):
    """Kopiert das Frontend und lädt die Messung vor dem Modul der Anzeige."""
    shutil.copytree(ROOT / "ambient-forge-web", target)
    (target / "display" / "instrument.js").write_text(INSTRUMENT)
    page = target / "display" / "index.html"
    html = page.read_text()
    page.write_text(html.replace('<script type="module"', '<script src="/display/instrument.js"></script>\n    <script type="module"'))


def browser(geckodriver, width, height):
    options = Options()
    options.binary_location = str(ENV / "bin" / "firefox")
    options.add_argument("-headless")
    options.add_argument(f"--width={width}")
    options.add_argument(f"--height={height}")
    return webdriver.Firefox(
        options=options,
        service=Service(executable_path=str(geckodriver), log_output=subprocess.DEVNULL),
    )


def fill(driver, element, value):
    element.clear()
    element.send_keys(value)


def click_text(driver, tag, text):
    for element in driver.find_elements(By.TAG_NAME, tag):
        if element.text.strip() == text and element.is_displayed():
            element.click()
            return True
    raise AssertionError(f"Kein <{tag}> mit dem Text {text!r}")


def page_text(driver):
    return driver.find_element(By.TAG_NAME, "body").text


def set_range(driver, element, value):
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
        element,
        value,
    )


def drag(driver, element, start_x, start_y, move_x, move_y):
    """Zieht mit echten Mausereignissen, wie eine Hand es tut."""
    steps = 6
    actions = ActionChains(driver, duration=30)
    actions.move_to_element_with_offset(element, start_x, start_y).click_and_hold()
    for _ in range(steps):
        actions.move_by_offset(move_x // steps, move_y // steps)
    actions.release().perform()


def level(driver):
    return driver.execute_script("return window.__level();")


def main():
    if shutil.which("ffmpeg") and not (MEDIA / "regen.wav").exists():
        subprocess.run([ROOT / "e2e" / "make-media.sh"], check=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="ambient-forge-firefox-"))
    os.environ["HOME"] = str(work)
    os.environ["PATH"] = f"{ENV / 'bin'}:{os.environ['PATH']}"
    os.environ["PULSE_RUNTIME_PATH"] = str(work / "pulse")
    os.environ["MOZ_DISABLE_CONTENT_SANDBOX"] = "1"

    subprocess.run(
        [ENV / "bin" / "pulseaudio", "--daemonize=yes", "--exit-idle-time=-1", "-n",
         "--load=module-native-protocol-unix", "--load=module-null-sink sink_name=leer"],
        check=False,
    )

    web = work / "web"
    prepare_web_dir(web)
    server = subprocess.Popen(
        [BINARY, "--port", str(PORT), "--web-dir", web, "--data-dir", work / "data"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    lines = []
    while True:
        line = server.stdout.readline()
        lines.append(line)
        if "Beenden mit" in line or not line:
            break
    password = re.search(r"Admin-Passwort: (\S+)", "".join(lines)).group(1)
    token = json.loads((work / "data" / "app.json").read_text())["link"]["token"]

    geckodriver = ENV / "bin" / "geckodriver"
    admin = browser(geckodriver, 1440, 900)
    display = browser(geckodriver, 1280, 720)
    print(f"\nFirefox {admin.capabilities['browserVersion']}", flush=True)

    try:
        print("\nPult bedienen", flush=True)
        admin.get(f"{LOCAL}/admin/")
        until(lambda: "/login" in admin.current_url)
        fill(admin, admin.find_element(By.ID, "passwort"), password)
        click_text(admin, "button", "Anmelden")
        check("Anmelden funktioniert", until(lambda: "Lege dein erstes Projekt an" in page_text(admin)))

        fill(admin, admin.find_element(By.ID, "erstes-projekt"), "Probe")
        click_text(admin, "button", "Projekt anlegen")
        until(lambda: admin.find_elements(By.ID, "neue-szene"))
        fill(admin, admin.find_element(By.ID, "neue-szene"), "Taverne")
        click_text(admin, "button", "Anlegen")
        check("Szene mit Platzhaltern erscheint", until(lambda: "Schwarzer Hintergrund" in page_text(admin)))

        inputs = lambda: admin.find_elements(By.CSS_SELECTOR, ".editor input[type=file]")
        inputs()[0].send_keys(str(MEDIA / "lila.png"))
        check("Bild-Upload funktioniert", until(lambda: "Schwarzer Hintergrund" not in page_text(admin)))
        inputs()[1].send_keys(str(MEDIA / "regen.wav"))
        check("Spur-Upload funktioniert", until(lambda: "Leere Tonspur" not in page_text(admin)))

        click_text(admin, "a", "Effekte")
        until(lambda: admin.find_elements(By.CSS_SELECTOR, "input[type=file]"))
        admin.find_element(By.CSS_SELECTOR, "input[type=file]").send_keys(
            "\n".join(str(MEDIA / name) for name in ["donner.flac", "tuer.opus", "wind.ogg"])
        )
        check("Effekte aus FLAC, Opus und OGG", until(lambda: len(admin.find_elements(By.CSS_SELECTOR, ".effekt")) == 3))

        click_text(admin, "a", "Pult")
        until(lambda: admin.find_elements(By.CSS_SELECTOR, ".kanal"))
        admin.save_screenshot(str(OUTPUT / "pult.png"))
        print("\nLayout", flush=True)
        admin.set_window_size(1440, 640)
        time.sleep(0.3)
        room = admin.execute_script(
            "window.scrollTo(0, 99999);"
            "return { scrollbar: document.documentElement.scrollHeight - window.innerHeight, scrolled: window.scrollY,"
            " footer: Math.round(window.innerHeight - document.querySelector('footer').getBoundingClientRect().bottom) };"
        )
        check("Seite selbst lässt sich nicht scrollen", room["scrollbar"] <= 0 and room["scrolled"] == 0, room)
        check("Footer klebt am unteren Rand", room["footer"] == 0, room)
        admin.set_window_size(1440, 900)
        time.sleep(0.3)
        fader = admin.find_element(By.CSS_SELECTOR, ".fader")
        size = fader.size

        print("\nRegler mit der Maus ziehen", flush=True)
        drag(admin, fader, size["width"] // 2 - 8, 0, -80, 0)
        value = float(admin.find_element(By.CSS_SELECTOR, ".fader").get_property("value"))
        check("Lautstärkeregler folgt der Maus", 0.3 < value < 0.8, value)
        panner = admin.find_element(By.CSS_SELECTOR, ".pan input")
        drag(admin, panner, 0, 0, 40, 0)
        value = float(admin.find_element(By.CSS_SELECTOR, ".pan input").get_property("value"))
        check("Panning folgt der Maus", value > 0.2, value)
        set_range(admin, admin.find_element(By.CSS_SELECTOR, ".fader"), 1)
        set_range(admin, admin.find_element(By.CSS_SELECTOR, ".pan input"), 0)

        time_slider = admin.find_element(By.CSS_SELECTOR, ".szenenwechsel input[type=range]")
        drag(admin, time_slider, -time_slider.size["width"] // 2 + 30, 0, 90, 0)
        project = next((work / "data" / "projects").glob("*.json"))
        stored = until(lambda: json.loads(project.read_text())["scenes"][0]["transitionMs"] != 2000)
        check("Zeitregler folgt der Maus und speichert", stored,
              json.loads(project.read_text())["scenes"][0]["transitionMs"])

        print("\nAnzeige starten", flush=True)
        display.get(f"{LOCAL}/d/{token}")
        button = until(lambda: display.find_element(By.ID, "start-button"))
        check("Startknopf erscheint", button.is_displayed())
        state = display.execute_script("return window.__context ? window.__context.state : 'fehlt'")
        check("Vor dem Klick ist der Ton gesperrt", state != "running", state)
        button.click()
        running = until(lambda: display.execute_script("return window.__context.state") == "running")
        check("Nach dem Klick läuft der Audiokontext", running,
              display.execute_script("return window.__context.state"))
        check("Pult meldet die Anzeige als bereit", until(lambda: "1 Anzeige bereit" in page_text(admin)))
        check("Wartebildschirm erscheint", "Gleich geht es weiter." in page_text(display))

        print("\nSzene und Ton", flush=True)
        click_text(admin, "button", "Zeigen")
        check("Bild erscheint", until(lambda: display.find_elements(By.CSS_SELECTOR, "#stage img")))
        check("Ton ist am Ausgang messbar", until(lambda: level(display)["left"] > AUDIBLE), level(display))
        time.sleep(2.2)
        display.save_screenshot(str(OUTPUT / "anzeige.png"))

        fader = admin.find_element(By.CSS_SELECTOR, ".fader")
        before = level(display)["left"]
        set_range(admin, fader, 0.3)
        check("Lautstärkeregler wirkt live", until(lambda: level(display)["left"] < before * 0.25), level(display))
        set_range(admin, admin.find_element(By.CSS_SELECTOR, ".fader"), 1)
        until(lambda: level(display)["left"] > before * 0.8)

        panner = admin.find_element(By.CSS_SELECTOR, ".pan input")
        set_range(admin, panner, -1)
        check("Panning links", until(lambda: level(display)["right"] < 0.01 and level(display)["left"] > AUDIBLE), level(display))
        set_range(admin, admin.find_element(By.CSS_SELECTOR, ".pan input"), 0)

        print("\nEffekte", flush=True)
        for name in ["donner", "tuer", "wind"]:
            count = display.execute_script("return window.__starts.length")
            click_text(admin, "button", name)
            check(f"Effekt {name} spielt", until(lambda: display.execute_script("return window.__starts.length") == count + 1))

        print("\nStream", flush=True)
        fill(admin, admin.find_element(By.ID, "neue-szene"), "Wald")
        click_text(admin, "button", "Anlegen")
        until(lambda: "Wald" in admin.find_element(By.CSS_SELECTOR, ".cues").text)
        until(lambda: "Leere Tonspur" in page_text(admin))
        inputs()[1].send_keys(str(MEDIA / "musik.mp3"))
        until(lambda: "Leere Tonspur" not in page_text(admin))
        Select(admin.find_element(By.CSS_SELECTOR, ".kanal select")).select_by_value("stream")
        time.sleep(0.3)
        click_text(admin, "button", "Zeigen")
        playing = until(lambda: display.execute_script(
            "return window.__streams.some((e) => !e.paused && e.currentTime > 0.1 && e.loop)"))
        check("Stream-Spur spielt in Firefox", playing)
        time.sleep(2.3)
        check("Stream läuft durch den Mixer", level(display)["left"] > AUDIBLE, level(display))

        print("\nMaster", flush=True)
        master = admin.find_element(By.CSS_SELECTOR, ".master")
        master.click()
        check("Ton blendet aus", until(lambda: level(display)["left"] < SILENT), level(display))
        black = "return Number(getComputedStyle(document.querySelectorAll('#stage > div')[1]).opacity)"
        check("Bild wird schwarz", until(lambda: display.execute_script(black) == 1))
        master.click()
        check("Bild kommt zurück", until(lambda: display.execute_script(black) == 0))
        check("Ton kommt zurück", until(lambda: level(display)["left"] > AUDIBLE), level(display))

        print("\nLink", flush=True)
        click_text(admin, "a", "Anzeige")
        until(lambda: "Anzeige-Link" in page_text(admin))
        click_text(admin, "button", "Link kopieren")
        check("Kopieren funktioniert", until(lambda: "Kopiert" in page_text(admin)))
        admin.save_screenshot(str(OUTPUT / "anzeige-link.png"))
        click_text(admin, "button", "Link deaktivieren")
        check("Deaktivieren erreicht die Anzeige", until(lambda: "deaktiviert" in page_text(display)))
        click_text(admin, "button", "Link aktivieren")
        check("Aktivieren startet die Anzeige neu", until(lambda: display.find_elements(By.CSS_SELECTOR, "#stage img")))
        click_text(admin, "button", "Link erneuern")
        click_text(admin, "button", "Alter Link wird ungültig. Erneuern?")
        check("Ungültiger Link wird gemeldet (Close-Code 4001)", until(lambda: "Dieser Link ist ungültig." in page_text(display)))

        print("\nProjekte", flush=True)
        click_text(admin, "a", "Projekte")
        check("Projekte-Bildschirm öffnet sich", until(lambda: "Alle Projekte" in page_text(admin)))
        admin.save_screenshot(str(OUTPUT / "projekte.png"))

        print("\nGriffe", flush=True)
        click_text(admin, "a", "Pult")
        until(lambda: admin.find_elements(By.CSS_SELECTOR, ".kanal"))
        names = lambda: [e.get_property("value") for e in admin.find_elements(By.CSS_SELECTOR, ".kanal input[type=text]")]
        grips = lambda: admin.find_elements(By.CSS_SELECTOR, ".spuren [data-sort-handle]")
        inputs()[1].send_keys(str(MEDIA / "regen.wav"))
        arrived = until(lambda: len(names()) == 2)
        check("Zweite Spur landet in der laufenden Szene", arrived, names())
        admin.save_screenshot(str(OUTPUT / "griffe.png"))
        tops = [e.rect for e in admin.find_elements(By.CSS_SELECTOR, ".kanal")]
        check("Spuren stehen untereinander", tops[1]["y"] > tops[0]["y"] and tops[1]["x"] == tops[0]["x"], tops)

        start = names()
        grips()[0].send_keys(Keys.ARROW_RIGHT)
        check("Griff funktioniert mit Pfeiltasten", until(lambda: names() == start[::-1]), names())
        focused = until(lambda: admin.execute_script("return document.activeElement.hasAttribute('data-sort-handle')"))
        check("Griff behält beim Verschieben den Fokus", focused)

        # Unter WebDriver liefert Firefox nach dem Ziehen kein drop, auch nicht bei einem
        # schlichten div. Start und Überfahren laufen deshalb nativ, das drop löst der
        # Test selbst aus.
        start = names()
        admin.execute_script(
            "document.addEventListener('dragstart', (event) => {"
            "  window.__dragSource = event.target.hasAttribute('data-sort-handle') ? 'griff' : 'anderes';"
            "}, true);"
        )
        target = admin.find_element(By.CSS_SELECTOR, ".spuren [data-sort-item]")
        admin.execute_script("arguments[0].scrollIntoView({ block: 'center' });", target)
        time.sleep(0.2)
        ActionChains(admin, duration=30).click_and_hold(grips()[1]).pause(0.2).move_by_offset(5, 5) \
            .pause(0.1).move_to_element(target).pause(0.3).perform()
        source = until(lambda: admin.execute_script("return window.__dragSource"))
        check("Firefox startet das Ziehen am Griff", source == "griff", source)
        check("Ziel wird beim Überfahren markiert", until(lambda: admin.find_elements(By.CSS_SELECTOR, ".spuren .ziel")))
        admin.execute_script(
            "arguments[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));", target
        )
        check("Spur landet am Ziel", until(lambda: names() == start[::-1]), names())
    finally:
        admin.quit()
        display.quit()
        server.terminate()
        server.wait()
        subprocess.run([ENV / "bin" / "pulseaudio", "--kill"], check=False)
        shutil.rmtree(work, ignore_errors=True)

    print(f"\n{passed} bestanden, {len(failures)} fehlgeschlagen", flush=True)
    for name in failures:
        print(f"  - {name}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
