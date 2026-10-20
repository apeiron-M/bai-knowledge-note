import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Where the primary control's centre sits, as a fraction of the pane height.
 * Measured from the reference: the composer's midline lands just below the
 * middle of the viewport, with the greeting lifted above it.
 */
const ANCHOR_Y = 0.53;
const MIN_TOP_PADDING = 24;

/**
 * The stage for the chat's landing states (connect panel, empty conversation).
 *
 * Everything here is positioned relative to one element — the control in
 * `anchorRef` (the composer, or the Connect button):
 *
 *  - **Placement.** The block is padded down so the anchor's centre lands at
 *    `ANCHOR_Y` of the pane, whatever sits above it. Centring the whole block
 *    instead would sink a tall block's control low and float a short block's
 *    control high; anchoring the control keeps it in the same place across
 *    both landing states. `tail` (topic chips, the paste-a-key disclosure)
 *    hangs beneath and never moves the control when it appears or grows.
 *
 *  - **Glow.** The radial gradients are centred on the anchor, so the pool of
 *    light is under the control, not at a percentage of the viewport.
 *
 * Both are recomputed whenever the pane, the block, or the anchor changes
 * size. The padding is derived from the anchor's offset *within the block*,
 * which the padding itself cannot change, so there is no layout feedback loop.
 * `background-attachment: local` keeps the glow with the content if the pane
 * ever has to scroll on a short viewport.
 */
export function LandingStage({
  anchorRef,
  tail,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  tail?: ReactNode;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    paddingTop: number;
    glowX: number;
    glowY: number;
  } | null>(null);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    const block = blockRef.current;
    const anchor = anchorRef.current;
    if (!pane || !block || !anchor) return;

    const measure = () => {
      const p = pane.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const offsetInBlock = a.top - b.top;
      const paddingTop = Math.max(
        MIN_TOP_PADDING,
        pane.clientHeight * ANCHOR_Y - offsetInBlock - a.height / 2,
      );
      setLayout({
        paddingTop,
        glowX: a.left - p.left + pane.scrollLeft + a.width / 2,
        glowY: paddingTop + offsetInBlock + a.height / 2,
      });
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    ro.observe(block);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [anchorRef]);

  // Before the first measurement, approximate so there is no flash.
  const at = layout
    ? `${layout.glowX}px ${layout.glowY}px`
    : `50% ${ANCHOR_Y * 100}%`;
  const style: CSSProperties = {
    paddingTop: layout?.paddingTop ?? MIN_TOP_PADDING,
    backgroundImage: [
      `radial-gradient(ellipse 55% 45% at ${at}, color-mix(in srgb, var(--bai-accent) 9%, transparent) 0%, transparent 70%)`,
      `radial-gradient(ellipse 95% 75% at ${at}, color-mix(in srgb, var(--bai-accent) 4%, transparent) 0%, transparent 78%)`,
    ].join(", "),
    backgroundAttachment: "local",
  };

  return (
    <div
      ref={paneRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-8"
      style={style}
    >
      {/* Opacity-only entrance: a translate would move the anchor mid-measure. */}
      <div
        ref={blockRef}
        className="motion-safe:animate-[bai-fade-in_.4s_ease-out] mx-auto flex w-full max-w-3xl shrink-0 flex-col items-center"
      >
        {children}
      </div>
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col items-center">
        {tail}
      </div>
      <style>{`@keyframes bai-fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
