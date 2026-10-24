import { shortAddress } from './wallet';
export interface CardResult { address: string; score: number; rank: string; roast: string; }
export function applicationUrl(): string | undefined {
  const url = new URL(window.location.href);
  if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname)) return;
  url.search = ''; url.hash = '';
  return url.href;
}
export function xShareUrl(result: CardResult, appUrl?: string): string {
  const text = `My Broke Score: ${result.score}/100. ${result.rank}.\n\n“${result.roast}”\n\nConnect nothing. Spend nothing. Get roasted.`;
  const params = new URLSearchParams({ text });
  if (appUrl) params.set('url', appUrl);
  return `https://twitter.com/intent/tweet?${params}`;
}
export async function downloadCard(result: CardResult): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser does not support image export.');
  ctx.fillStyle = '#141612'; ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = '#30362a';
  for (let x = 0; x < 1200; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke(); }
  for (let y = 0; y < 630; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }
  ctx.fillStyle = '#c4fa61'; ctx.fillRect(42, 42, 1116, 5);
  ctx.font = 'bold 28px sans-serif'; ctx.fillText('PROOF OF BROKE', 96, 98);
  ctx.strokeStyle = '#c4fa61'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(64, 78); ctx.lineTo(81, 95); ctx.moveTo(64, 95); ctx.lineTo(81, 95); ctx.lineTo(81, 78); ctx.stroke();
  ctx.fillStyle = '#a5ab9d'; ctx.font = '20px monospace'; ctx.fillText(shortAddress(result.address), 930, 98);
  ctx.fillStyle = '#c4fa61'; ctx.font = 'bold 160px sans-serif'; ctx.fillText(String(result.score), 60, 285);
  ctx.fillStyle = '#a5ab9d'; ctx.font = '24px monospace'; ctx.fillText('/ 100 BROKE SCORE', 300, 275);
  ctx.fillStyle = '#f3f5ec'; ctx.font = 'bold 30px sans-serif'; ctx.fillText(result.rank.toUpperCase(), 64, 340);
  ctx.font = 'bold 38px sans-serif';
  const words = `“${result.roast}”`.split(' ');
  let line = ''; let y = 411;
  for (const word of words) {
    const next = `${line}${word} `;
    if (ctx.measureText(next).width > 1050 && line) { ctx.fillText(line.trim(), 64, y); line = `${word} `; y += 48; }
    else line = next;
  }
  ctx.fillText(line.trim(), 64, y);
  ctx.fillStyle = '#a5ab9d'; ctx.font = '18px sans-serif';
  ctx.fillText('Native SOL only. Certified parody. Not financial advice.', 64, 574);
  const appUrl = applicationUrl();
  if (appUrl) { ctx.textAlign = 'right'; ctx.font = '16px sans-serif'; ctx.fillText(new URL(appUrl).host, 1136, 574, 460); }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed. Please try again.')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `proof-of-broke-${shortAddress(result.address)}.png`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
