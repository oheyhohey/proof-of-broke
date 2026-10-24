import { useState, type FormEvent } from 'react';
import { getBalance, isValidAddress, lamportsToSol, shortAddress } from './lib/wallet';
import { ranks, scoreForLamports, selectRoast } from './lib/roasts';
import { applicationUrl, downloadCard, xShareUrl } from './lib/share';

function Arrow() { return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16 16 4M4 4h12v12" stroke="currentColor" strokeWidth="1.7"/></svg>; }
export default function App() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<{ address: string; lamports: number; checkedAt: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const score = result ? scoreForLamports(result.lamports) : null;
  const card = result && score !== null ? { address: result.address, score, rank: ranks[score], roast: selectRoast(result.address, score, offset) } : null;
  async function analyze(event: FormEvent) {
    event.preventDefault();
    const normalized = address.trim();
    setError(''); setNotice(''); setResult(null); setOffset(0);
    if (!isValidAddress(normalized)) { setError('That is not a valid Solana public address. Check the address and try again.'); return; }
    setLoading(true);
    try { const lamports = await getBalance(normalized); setResult({ address: normalized, lamports, checkedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Balance check failed. Please try again.'); }
    finally { setLoading(false); }
  }
  async function saveCard() {
    if (!card) return;
    setExporting(true); setNotice('');
    try { await downloadCard(card); setNotice('PNG downloaded. Attach it yourself when posting on X.'); }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Could not export image. Try again.'); }
    finally { setExporting(false); }
  }
  return <div className="site-shell">
    <header className="header"><a href="#" className="brand" aria-label="Proof of Broke home"><span className="brand-icon" aria-hidden="true"><Arrow /></span>proof of broke<span className="brand-dot">®</span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works <span><Arrow /></span></a><span className="network"><i /> Solana mainnet</span></nav></header>
    <main>
      <section className="hero" aria-labelledby="headline">
        <div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> THE FINANCIAL REALITY CHECK NOBODY ASKED FOR</div><h1 id="headline">Big dreams.<br/>Small <span className="sol-word">SOL<span className="scribble" aria-hidden="true" /></span> energy.</h1><p className="hero-description">Your wallet has a story.<br/>It’s probably a tragedy. Let’s find out.</p><div className="tagline"><span>↳</span> Connect nothing. Spend nothing. Get roasted.</div></div>
        <div className="specimen" aria-label="Illustrative sample, not a real wallet result"><div className="receipt-top"><span>PROOF OF BROKE</span><span>EXHIBIT A</span></div><div className="receipt-face" aria-hidden="true"><span className="eye">×</span><span className="eye">×</span><span className="mouth" /></div><div className="receipt-title">EMOTIONALLY<br/>OVERINVESTED.</div><div className="receipt-bottom"><span>HOPIUM: UNLIMITED<br/>LIQUIDITY: QUESTIONABLE</span><span className="stamp">100%<br/>COPE</span></div><div className="receipt-caption">ILLUSTRATION ONLY · NO WALLET CHECKED</div></div>
      </section>
      <section className="analyzer" aria-labelledby="analyzer-heading"><div className="analyzer-intro"><span className="section-number">01 / THE DAMAGE REPORT</span><h2 id="analyzer-heading">Drop the address.<br/> Keep the delusion.</h2><p>Public wallet. Private humiliation.<br/>Until you share it, obviously.</p></div><div className="form-area"><form onSubmit={analyze} noValidate><label htmlFor="wallet">SOLANA WALLET ADDRESS <span>PUBLIC ADDRESS ONLY</span></label><div className="input-row"><input id="wallet" name="wallet" value={address} onChange={e => setAddress(e.target.value)} placeholder="Paste your Solana address…" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={loading} aria-describedby={error ? 'wallet-error wallet-hint' : 'wallet-hint'} aria-invalid={!!error}/><button className="primary" disabled={loading} type="submit">{loading ? 'Checking…' : 'Roast my wallet'} <span aria-hidden="true"><Arrow /></span></button></div><p id="wallet-hint" className="input-hint"><span>⌁</span> No connection. No signatures. No funds touched.</p>{error && <p className="error" id="wallet-error" role="alert">{error}</p>}<div role="status" className={loading ? 'loading-status' : 'sr-only'}>{loading ? 'Reading your real native SOL balance. Preparing emotional damage…' : ''}</div></form></div></section>
      {card && result ? <section className="result-section" aria-labelledby="result-title" aria-live="polite"><div className="result-card"><div className="result-top"><span>YOUR OFFICIAL DAMAGE REPORT</span><span title={result.address}>{shortAddress(result.address)} · {result.checkedAt}</span></div><div className="result-body"><div className="score-block"><span className="score">{card.score}</span><span className="score-total">/100</span><p>BROKE SCORE</p></div><div className="roast-block"><span className="rank" id="result-title">{card.rank}</span><blockquote>“{card.roast}”</blockquote><p className="balance">{lamportsToSol(result.lamports)} <span>SOL · NATIVE BALANCE</span></p></div></div><div className="score-track" aria-hidden="true"><span style={{ width: `${card.score}%` }}/></div><p className="result-disclaimer">Snapshot of native SOL only. Other tokens, NFTs, staking accounts, and your mysterious offshore hopium are not included.</p></div><div className="result-actions"><button type="button" className="secondary" onClick={() => { setOffset(n => n + 1); setNotice(''); }}>↻ Roast again</button><button type="button" className="secondary" onClick={saveCard} disabled={exporting}>{exporting ? 'Exporting…' : '↓ Download card'}</button><a className="primary" href={xShareUrl(card, applicationUrl())} target="_blank" rel="noopener noreferrer">Share on X <Arrow /></a></div><p className="share-note">Download your 1200 × 630 card and attach it to your post. X won’t attach it automatically.</p><p role="status" className="notice">{notice}</p></section> : !loading && <div className="empty-note"><span>↳</span> Your roast is waiting. Unlike your airdrop, this one actually exists.</div>}
      <section className="how-section" id="how-it-works"><div className="section-heading"><span className="section-number">02 / TRUST THE PROCESS. QUESTION YOUR BAGS.</span><h2>Three steps to<br/>financial self-awareness.</h2></div><div className="steps"><article><span>01</span><h3>Paste your public address.</h3><p>No wallet connection. No awkward signature requests. Just the address.</p></article><article><span>02</span><h3>We check. You cope.</h3><p>Real mainnet SOL balance. A deeply unserious score. An uncomfortably specific roast.</p></article><article><span>03</span><h3>Make it everyone’s problem.</h3><p>Download your receipt. Share it on X. Call it community building.</p></article></div></section>
      <section className="fine-print"><span>ⓘ</span><p><strong>A roast, not a financial report.</strong> Native SOL is only one part of a wallet and does not represent total portfolio value or personal wealth. This is parody, not financial advice. Addresses pass through this app’s balance proxy to Solana’s public RPC; hosting and RPC providers may log requests. This app has no database and does not save submitted addresses. Never enter private keys or seed phrases.</p></section>
    </main><footer><a className="brand" href="#"><span className="brand-icon" aria-hidden="true"><Arrow /></span>proof of broke</a><span>BUILT ON SOLANA. POWERED BY POOR DECISIONS.</span><span>Zero fees. Some feelings.</span></footer>
  </div>;
}
