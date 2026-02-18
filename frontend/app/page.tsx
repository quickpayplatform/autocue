export default function HomePage() {
  return (
    <section className="landing">
      <div className="landing-card">
        <p className="eyebrow">AutoCue</p>
        <h2>Precision cues. Human-approved.</h2>
        <p className="lede">
          Remote lighting cue requests for ETC Eos with validation, operator approval,
          and secure OSC execution.
        </p>
        <div className="cta-row">
          <a className="button" href="/login">Login</a>
          <span className="glow">Trusted control for live shows.</span>
        </div>
      </div>
    </section>
  );
}
