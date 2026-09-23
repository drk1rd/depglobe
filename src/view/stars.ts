// Twinkling parallax starfield with the occasional shooting star.
export function startStars(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1;
  type Star = { x: number; y: number; z: number; p: number; hue: number };
  let stars: Star[] = [];
  let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let mx = 0, my = 0;

  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    const n = Math.round((innerWidth * innerHeight) / 3500);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() ** 2,
      p: Math.random() * Math.PI * 2,
      hue: 40,
    }));
  };
  resize();
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth - 0.5) * 2;
    my = (e.clientY / innerHeight - 0.5) * 2;
  });

  let t = 0;
  const frame = () => {
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.25 + 0.75 * s.z * (0.6 + 0.4 * Math.sin(t * (1 + s.z * 2) + s.p));
      const r = (0.4 + s.z * 1.3) * dpr;
      const x = s.x - mx * s.z * 14 * dpr;
      const y = s.y - my * s.z * 14 * dpr;
      ctx.fillStyle = `hsla(${s.hue}, 20%, 92%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!shoot && Math.random() < 0.004) {
      shoot = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.4, vx: (8 + Math.random() * 6) * dpr, vy: (3 + Math.random() * 3) * dpr, life: 1 };
    }
    if (shoot) {
      const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 12, shoot.y - shoot.vy * 12);
      g.addColorStop(0, `rgba(255,255,255,${shoot.life})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(shoot.x, shoot.y);
      ctx.lineTo(shoot.x - shoot.vx * 12, shoot.y - shoot.vy * 12);
      ctx.stroke();
      shoot.x += shoot.vx;
      shoot.y += shoot.vy;
      shoot.life -= 0.018;
      if (shoot.life <= 0) shoot = null;
    }
    if (!reduce) requestAnimationFrame(frame);
  };
  frame();
}
