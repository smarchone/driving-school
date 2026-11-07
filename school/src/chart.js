// Debrief chart: your pedals and speed vs the reference, with mistakes marked. Click/drag to scrub.

const LANES = [
  { key: 'clu', label: 'Clutch', color: '#f5b942', max: 1 },
  { key: 'thr', label: 'Gas', color: '#3ee08f', max: 1 },
  { key: 'brk', label: 'Brake', color: '#ff6b6b', max: 1 },
  { key: 'v', label: 'Speed', color: '#9db8ff', max: null, fmt: v => `${Math.round(v * 3.6)} km/h` },
];
const REF = '#37d6c8';

export function createChart(canvas, onSeek) {
  let data = null;
  const ctx = canvas.getContext('2d');
  const PADL = 64, PADR = 14, PADT = 8, PADB = 22;

  function xOf(f) {
    return data.align === 'distance' ? f.s - data.s0 : f.t - data.t0;
  }
  function refX(f) {
    return data.align === 'distance' ? f.s - data.rs0 : f.t - data.rt0;
  }

  function set(d) {
    const frames = d.frames;
    data = {
      ...d,
      t0: frames[0].t, s0: frames[0].s,
      rt0: d.ref?.[0]?.t ?? 0, rs0: d.ref?.[0]?.s ?? 0,
    };
    const xs = frames.map(xOf);
    const rx = (d.ref || []).map(refX);
    data.xmin = Math.min(0, ...xs.slice(0, 1));
    data.xmax = Math.max(xs[xs.length - 1], ...xs, ...(d.trimRef ? [] : rx.slice(-1)), ...(d.marks || []).map(m => m.x + 3)) || 1;
    data.vmax = Math.max(4, ...frames.map(f => Math.abs(f.v)), ...(d.ref || []).map(f => f.v)) * 1.1;
    draw(d.playhead ?? 0);
  }

  function draw(playhead) {
    if (!data) return;
    const dpr = Math.min(devicePixelRatio, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const plotW = W - PADL - PADR;
    const lanes = data.noClutch ? LANES.filter(l => l.key !== 'clu') : LANES;
    const laneH = (H - PADT - PADB) / lanes.length;
    const X = x => PADL + (x - data.xmin) / (data.xmax - data.xmin) * plotW;

    ctx.font = '12px Inter, system-ui, sans-serif';
    lanes.forEach((lane, li) => {
      const top = PADT + li * laneH, bot = top + laneH - 6;
      const max = lane.max ?? data.vmax;
      const Y = v => bot - Math.max(0, Math.min(1, v / max)) * (bot - top - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(PADL, top, plotW, bot - top);
      if (lane.key === 'clu') {
        // the bite zone: where the clutch starts to grip
        ctx.fillStyle = 'rgba(245,185,66,0.13)';
        ctx.fillRect(PADL, Y(0.65), plotW, Y(0.55) - Y(0.65));
      }
      ctx.fillStyle = 'rgba(232,236,241,0.62)';
      ctx.textAlign = 'right';
      ctx.fillText(lane.label, PADL - 10, (top + bot) / 2 + 4);
      if (data.ref) {
        ctx.strokeStyle = REF; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath();
        data.ref.forEach((f, i) => { const x = X(refX(f)), y = Y(Math.max(0, f[lane.key])); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = lane.color; ctx.lineWidth = 2;
      ctx.beginPath();
      data.frames.forEach((f, i) => { const x = X(xOf(f)), y = Y(Math.max(0, f[lane.key])); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    });

    // axis
    ctx.fillStyle = 'rgba(232,236,241,0.45)';
    ctx.textAlign = 'center';
    const unit = data.align === 'distance' ? 'm' : 's';
    const span = data.xmax - data.xmin;
    const step = span > 120 ? 20 : span > 60 ? 10 : span > 25 ? 5 : 2;
    for (let x = Math.ceil(data.xmin / step) * step; x <= data.xmax; x += step) {
      ctx.fillText(`${x}${unit}`, X(x), H - 6);
    }

    // Reference marks on a distance axis: where to brake, where the line is.
    for (const mk of data.marks || []) {
      const x = X(mk.x);
      ctx.strokeStyle = mk.color; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, PADT); ctx.lineTo(x, H - PADB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = mk.color; ctx.textAlign = 'right'; ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText(mk.label, x - 4, PADT + 12);
    }
    ctx.font = '12px Inter, system-ui, sans-serif';

    for (const ev of data.events || []) {
      const f = data.frames[ev.frame];
      if (!f) continue;
      const x = X(xOf(f));
      ctx.strokeStyle = ev.severity === 'major' ? 'rgba(255,107,107,0.9)' : 'rgba(245,185,66,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, PADT); ctx.lineTo(x, H - PADB); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(x, PADT + 5, 4.5, 0, Math.PI * 2); ctx.fill();
    }

    const pf = data.frames[Math.round(playhead)];
    if (pf) {
      const x = X(xOf(pf));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, PADT); ctx.lineTo(x, H - PADB); ctx.stroke();
    }
  }

  function frameAtPx(px) {
    if (!data) return 0;
    const W = canvas.clientWidth;
    const x = data.xmin + (px - PADL) / (W - PADL - PADR) * (data.xmax - data.xmin);
    let best = 0, bd = Infinity;
    data.frames.forEach((f, i) => { const d = Math.abs(xOf(f) - x); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  let dragging = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); onSeek(frameAtPx(e.offsetX)); });
  canvas.addEventListener('pointermove', e => { if (dragging) onSeek(frameAtPx(e.offsetX)); });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  return { set, draw };
}
