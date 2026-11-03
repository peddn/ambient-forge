// Diashow: lädt Bilder vorab und blendet das nächste Bild über das aktuelle.
// Dieser Ordner läuft ohne Build: nur Syntax bis ES2019 verwenden.

const ELEMENT_STYLE = "position:absolute;top:0;left:0;width:100%;height:100%;";
const MIN_GAP_MS = 100;

export function createSlideshow(options) {
  const root = options.root;
  const resolveAsset = options.resolveAsset;
  const fit = options.fit || "cover";

  let slides = [];
  let index = -1;
  let timer = null;
  let cleanupTimer = null;
  let updateToken = 0;
  let timing = { slideDurationMs: 30000, slideFadeMs: 2000 };

  function createElement(assetId) {
    return new Promise((resolve, reject) => {
      const element = new Image();
      const failed = () => reject(new Error("Bild konnte nicht geladen werden"));
      element.alt = "";
      element.style.cssText = ELEMENT_STYLE + "object-fit:" + fit + ";opacity:0;";
      element.onerror = failed;
      element.src = resolveAsset(assetId);
      if (element.decode) {
        element.decode().then(() => resolve(element), failed);
      } else {
        element.onload = () => resolve(element);
      }
    });
  }

  function present(element, fadeMs) {
    if (root.lastChild === element) return;
    element.style.transition = "none";
    element.style.opacity = "0";
    root.appendChild(element);
    void element.offsetWidth;
    element.style.transition = "opacity " + fadeMs + "ms linear";
    element.style.opacity = "1";
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      while (root.firstChild && root.firstChild !== element) {
        root.removeChild(root.firstChild);
      }
    }, fadeMs + 50);
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (slides.length < 2) return;
    const wait = Math.max(timing.slideDurationMs, timing.slideFadeMs + MIN_GAP_MS);
    timer = setTimeout(advance, wait);
  }

  function advance() {
    index = (index + 1) % slides.length;
    present(slides[index].element, timing.slideFadeMs);
    schedule();
  }

  // Lädt alle Bilder einer Szene. Bilder, die schon angezeigt werden, bleiben
  // erhalten. Fehlerhafte Bilder werden gemeldet und ausgelassen.
  function prepare(images, report) {
    const known = new Map(slides.map((slide) => [slide.id, slide]));
    const tasks = images.map((image) => {
      const existing = known.get(image.id);
      if (existing && existing.assetId === image.assetId) {
        report(image.assetId, null);
        return Promise.resolve(existing);
      }
      return createElement(image.assetId).then(
        (element) => {
          report(image.assetId, null);
          return { id: image.id, assetId: image.assetId, element };
        },
        (error) => {
          report(image.assetId, error);
          return null;
        }
      );
    });
    return Promise.all(tasks).then((loaded) => loaded.filter(Boolean));
  }

  function setTiming(scene) {
    timing = {
      slideDurationMs: scene.slideDurationMs,
      slideFadeMs: scene.slideFadeMs,
    };
  }

  // Wechselt zu vorbereiteten Bildern einer neuen Szene.
  function show(prepared, scene, fadeMs) {
    updateToken += 1;
    setTiming(scene);
    slides = prepared;
    index = slides.length > 0 ? 0 : -1;
    if (index >= 0) {
      present(slides[0].element, fadeMs);
    } else {
      clear(fadeMs);
      return;
    }
    schedule();
  }

  // Übernimmt Änderungen an der laufenden Szene, ohne die Diashow neu zu starten.
  function update(scene, report) {
    updateToken += 1;
    const token = updateToken;
    const timingChanged =
      timing.slideDurationMs !== scene.slideDurationMs ||
      timing.slideFadeMs !== scene.slideFadeMs;
    setTiming(scene);

    return prepare(scene.images, report).then((next) => {
      if (token !== updateToken) return;
      const currentSlide = slides[index];
      const sameList =
        next.length === slides.length &&
        next.every((slide, position) => slides[position].id === slide.id);
      slides = next;

      if (next.length === 0) {
        clear(timing.slideFadeMs);
        return;
      }
      const position = currentSlide
        ? next.findIndex((slide) => slide.id === currentSlide.id)
        : -1;
      if (position >= 0) {
        index = position;
      } else {
        index = 0;
        present(next[0].element, timing.slideFadeMs);
      }
      if (!sameList || timingChanged) schedule();
    });
  }

  function clear(fadeMs) {
    updateToken += 1;
    clearTimeout(timer);
    timer = null;
    slides = [];
    index = -1;
    if (fadeMs > 0 && root.firstChild) {
      const blank = document.createElement("div");
      blank.style.cssText = ELEMENT_STYLE + "background:#000;opacity:0;";
      present(blank, fadeMs);
    } else {
      clearTimeout(cleanupTimer);
      while (root.firstChild) root.removeChild(root.firstChild);
    }
  }

  return { prepare, show, update, clear };
}
