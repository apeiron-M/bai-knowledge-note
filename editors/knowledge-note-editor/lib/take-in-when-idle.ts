/**
 * Put `value` into an uncontrolled text box unless someone is typing in it.
 * Returns true when the box's text was replaced.
 *
 * The note editor's claim and description are uncontrolled (`defaultValue`) so
 * typing never fights a render; without this they kept the text they mounted
 * with when the note changed elsewhere (another tab, an agent, the pipeline).
 */
export function takeInWhenIdle(el: HTMLTextAreaElement, value: string): boolean {
  if (el.ownerDocument.activeElement === el || el.value === value) return false;
  el.value = value;
  return true;
}
