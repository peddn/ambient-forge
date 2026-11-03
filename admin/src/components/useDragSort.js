import { ref } from "vue";

// Sortieren per Ziehen für Listen. `commit` bekommt die neue Reihenfolge der IDs.
export function useDragSort(commit) {
  const dragging = ref(null);
  const over = ref(null);

  function handlers(id) {
    return {
      draggable: true,
      onDragstart(event) {
        dragging.value = id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      },
      onDragover(event) {
        if (dragging.value === null) return;
        event.preventDefault();
        over.value = id;
      },
      onDrop(event) {
        event.preventDefault();
        const from = dragging.value;
        dragging.value = null;
        over.value = null;
        if (from !== null && from !== id) commit(from, id);
      },
      onDragend() {
        dragging.value = null;
        over.value = null;
      },
    };
  }

  return { dragging, over, handlers };
}

export function moved(ids, from, to) {
  const next = ids.filter((id) => id !== from);
  next.splice(ids.indexOf(to), 0, from);
  return next;
}
