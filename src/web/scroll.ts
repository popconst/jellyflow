// Keeping a list's cursor in sight by scrolling the list itself, and nothing
// around it: lists that sit in a 3D scene (an opened page) mustn't move it.

/** Scrolls `list` to show `el`: just into sight, or in the middle */
export function keepInView(list: HTMLElement | undefined, el: Element | null | undefined, middle = false): void {
  if (!list || !(el instanceof HTMLElement) || !list.contains(el)) return
  const top = el.offsetParent === list ? el.offsetTop : el.offsetTop - list.offsetTop
  if (middle) list.scrollTop = top - (list.clientHeight - el.offsetHeight) / 2
  else if (top < list.scrollTop) list.scrollTop = top
  else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight
}
