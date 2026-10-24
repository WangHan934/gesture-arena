// One raised index finger draws; a 1.5 s pause or lowering the hand submits.
export class AirStroke {
  constructor(onStroke) { this.onStroke = onStroke; this.reset(); }
  reset() { this.points = []; this.last = null; this.anchor = null; this.stillSince = null; this.locked = false; }
  submit() {
    if (this.points.length >= 4) this.onStroke(this.points.slice());
    this.points = []; this.stillSince = null; this.anchor = null;
  }
  update(frame, now, enabled) {
    if (!enabled) { this.reset(); return; }
    const finger = frame?.pose === 'one' ? frame.landmarks?.[8] : null;
    if (!finger) { if (!this.locked) this.submit(); this.reset(); return; }
    // Mirror horizontally to match the camera preview.
    const raw = { x: (1 - finger.x) * 400, y: finger.y * 400 };
    const smooth = this.last ? { x: this.last.x * .55 + raw.x * .45, y: this.last.y * .55 + raw.y * .45 } : raw;
    this.last = smooth;
    if (this.locked) return;
    if (!this.anchor || Math.hypot(raw.x - this.anchor.x, raw.y - this.anchor.y) > 10) {
      this.anchor = raw; this.stillSince = now;
    }
    const previous = this.points.at(-1);
    if (!previous || Math.hypot(smooth.x - previous.x, smooth.y - previous.y) > 3) {
      if (this.points.length < 400) this.points.push(smooth);
    }
    if (this.points.length >= 4 && now - this.stillSince >= 1500) { this.submit(); this.locked = true; }
  }
}
