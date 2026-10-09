import { QRCodeSVG } from 'qrcode.react';

interface Props {
  value: string;
  /** Any CSS length, e.g. "180px" or "min(60vh, 45vw)". */
  width: string;
  title: string;
}

/** Black on white in both themes (some scanners fail on inverted codes), with a 4-module quiet zone. */
export function QrCard({ value, width, title }: Props) {
  return (
    <div className="qr-card" style={{ width }}>
      <QRCodeSVG
        value={value}
        level="M"
        marginSize={4}
        fgColor="#000000" // theme-exempt: QR must stay black on white
        bgColor="#FFFFFF" // theme-exempt: QR must stay black on white
        size={512}
        title={title}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    </div>
  );
}
