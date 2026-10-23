import QRCode from 'qrcode';

/** Inline SVG of a QR code carrying exactly `text` (the label number). Error correction M survives scuffed printing. */
export function qrSvg(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const d: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${text}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d.join('')}" fill="#000"/></svg>`;
}
