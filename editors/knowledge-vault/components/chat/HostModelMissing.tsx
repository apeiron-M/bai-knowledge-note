/**
 * The desktop app manages the model and none is set up: one sentence, one way forward.
 *
 * With no opener there is no button to show (a dead one would be worse than none), so the
 * panel says where the setting lives instead.
 */
export function HostModelMissing({
  vaultName,
  onOpenSettings,
}: {
  vaultName: string;
  /** Opens the app's model settings; null when the app gave the chat no way to. */
  onOpenSettings: (() => void) | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-medium" style={{ color: "var(--bai-text)" }}>
        No AI model is set up yet
      </h2>
      <p className="max-w-md text-sm" style={{ color: "var(--bai-text-secondary)" }}>
        Chatting with {vaultName} and turning sources into notes both need an AI model: one on this computer, your ChatGPT plan, OpenRouter, or an API key.
      </p>
      {onOpenSettings ? (
        <button
          type="button"
          onClick={() => onOpenSettings()}
          className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--bai-accent)]"
          style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
        >
          Set up an AI model
        </button>
      ) : (
        <p className="text-sm" style={{ color: "var(--bai-text-tertiary)" }}>
          Choose one in the app&apos;s Settings › Models.
        </p>
      )}
    </div>
  );
}
