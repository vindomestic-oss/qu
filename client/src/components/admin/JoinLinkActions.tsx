import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { buildJoinUrl } from '../../lib/joinLink';

/** "Copy link" (clipboard only in a secure context, else a selectable field) and "Download QR (PNG)". */
export function JoinLinkActions({ code }: { code: string }) {
  const url = buildJoinUrl(code);
  const [copied, setCopied] = useState(false);
  const [showField, setShowField] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function copy() {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // fall through to the field
      }
    }
    setShowField(true);
  }

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `ejka-quiz-${code}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <button type="button" onClick={download}>
        Download QR (PNG)
      </button>
      {showField && (
        <input
          readOnly
          value={url}
          aria-label="Join link"
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
          ref={(el) => el?.select()}
          style={{ minWidth: 260 }}
        />
      )}
      <QRCodeCanvas ref={canvasRef} value={url} level="M" marginSize={4} size={1024} style={{ display: 'none' }} />
    </div>
  );
}
