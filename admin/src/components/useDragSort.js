import { nextTick, ref, watch } from "vue";

// Sortieren über einen Griff. Regler und Tasten in einem Eintrag bleiben dadurch
// bedienbar, weil nur der Griff das Ziehen startet.
//
//   const sort = useDragSort(() => ids, (neueReihenfolge) => speichern(neueReihenfolge));
//   <li v-bind="sort.item(id)"><DragHandle v-bind="sort.handle(id)" label="…" /></li>
export function useDragSort(getIds, commit) {
  const dragging = ref(null);
  const over = ref(null);
  let refocusId = null;

  function reset() {
    dragging.value = null;
    over.value = null;
  }

  function move(from, to) {
    const ids = getIds();
    const next = ids.filter((id) => id !== from);
    next.splice(ids.indexOf(to), 0, from);
    commit(next);
  }

  function step(id, offset) {
    const ids = getIds();
    const target = ids[ids.indexOf(id) + offset];
    if (target === undefined) return;
    refocusId = id;
    move(id, target);
  }

  // Der Eintrag wird beim Verschieben neu eingehängt und verliert dabei den Fokus.
  watch(getIds, async () => {
    if (refocusId === null) return;
    const id = refocusId;
    refocusId = null;
    await nextTick();
    document.querySelector(`[data-sort-item="${id}"] [data-sort-handle]`)?.focus();
  });

  function item(id) {
    return {
      "data-sort-item": id,
      onDragover(event) {
        if (dragging.value === null) return;
        event.preventDefault();
        over.value = id;
      },
      onDrop(event) {
        event.preventDefault();
        const from = dragging.value;
        reset();
        if (from !== null && from !== id) move(from, id);
      },
    };
  }

  function handle(id) {
    return {
      "data-sort-handle": "",
      draggable: "true",
      onDragstart(event) {
        dragging.value = id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        const entry = event.currentTarget.closest("[data-sort-item]");
        if (entry) event.dataTransfer.setDragImage(entry, 16, 16);
      },
      onDragend: reset,
      onKeydown(event) {
        const offset = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        step(id, offset);
      },
    };
  }

  return { over, item, handle };
}
