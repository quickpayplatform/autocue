"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";

interface Venue {
  id: string;
  name: string;
}

interface RigVersion {
  id: string;
  name: string;
  status: string;
}

interface CueEvent {
  id: string;
  t_ms: number;
  type: string;
}

interface RigDetail {
  stageBackgrounds: Array<{ image_url: string; calibration: any; width_px: number; height_px: number }>;
  fixtures: Array<{ id: string; label: string; fixture_type_id: string }>;
  fixtureTypes: Array<{ id: string; capabilities: any }>;
  placements: Array<{ fixture_instance_id: string; stage_x: number; stage_y: number }>;
}

export default function AutoQueSessionPage() {
  const [token, setToken] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [rigVersions, setRigVersions] = useState<RigVersion[]>([]);
  const [rigVersionId, setRigVersionId] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaDuration, setMediaDuration] = useState(60000);
  const [palette, setPalette] = useState("Amber,#d6a469;Teal,#1f9f9a;Coral,#d76b6b");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cueTime, setCueTime] = useState(0);
  const [cueType, setCueType] = useState("LOOK");
  const [cueIntensity, setCueIntensity] = useState(0.6);
  const [cueEvents, setCueEvents] = useState<CueEvent[]>([]);
  const [rigDetail, setRigDetail] = useState<RigDetail | null>(null);
  const [rigMismatch, setRigMismatch] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("autoque_token"));
  }, []);

  async function loadVenues() {
    if (!token) return;
    const data = await apiFetch<Venue[]>("/venues", { method: "GET" }, token);
    setVenues(data);
    if (!venueId && data.length > 0) {
      setVenueId(data[0].id);
    }
  }

  async function loadRigVersions(selectedVenueId: string) {
    if (!token || !selectedVenueId) return;
    const data = await apiFetch<RigVersion[]>(
      `/rigs?theatreId=${encodeURIComponent(selectedVenueId)}`,
      { method: "GET" },
      token
    );
    setRigVersions(data);
    if (!rigVersionId && data.length > 0) {
      setRigVersionId(data[0].id);
    }
  }

  async function loadRigDetail(selectedRigId: string) {
    if (!token || !selectedRigId) return;
    const detail = await apiFetch<RigDetail>(`/rigs/${selectedRigId}/detail`, { method: "GET" }, token);
    setRigDetail(detail);
  }

  useEffect(() => {
    loadVenues().catch((error) => setMessage((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (venueId) {
      loadRigVersions(venueId).catch((error) => setMessage((error as Error).message));
    }
  }, [venueId]);

  useEffect(() => {
    if (rigVersionId) {
      loadRigDetail(rigVersionId).catch((error) => setMessage((error as Error).message));
    }
  }, [rigVersionId]);

  async function createSession() {
    if (!token || !venueId || !rigVersionId) return;
    const media = await apiFetch<{ id: string }>("/autoque/media-assets", {
      method: "POST",
      body: JSON.stringify({ theatreId: venueId, type: "AUDIO", url: mediaUrl, durationMs: mediaDuration })
    }, token);

    const paletteItems = palette
      .split(";")
      .map((entry) => entry.split(","))
      .map(([name, hex]) => ({ name: name.trim(), hex: (hex ?? "").trim() }))
      .filter((item) => item.name && item.hex);

    const session = await apiFetch<{ id: string }>("/autoque/sessions", {
      method: "POST",
      body: JSON.stringify({
        theatreId: venueId,
        rigVersionId,
        mediaAssetId: media.id,
        theme: {
          palette: paletteItems,
          constraints: {
            warmCoolBias: "NEUTRAL",
            saturationLimit: 0.9,
            allowStrobe: false,
            maxIntensity: 0.9,
            movementSpeedLimit: 0.7,
            skinSafeFrontlight: true
          }
        }
      })
    }, token);

    setSessionId(session.id);
    setMessage("AutoQue session created.");
  }

  async function loadCueEvents() {
    if (!token || !sessionId) return;
    const data = await apiFetch<CueEvent[]>(`/autoque/sessions/${sessionId}/cues`, { method: "GET" }, token);
    setCueEvents(data);
  }

  async function generateDraft() {
    if (!token || !sessionId) return;
    await apiFetch(`/autoque/sessions/${sessionId}/generate`, { method: "POST" }, token);
    await loadCueEvents();
  }

  async function checkRigMismatch() {
    if (!token || !sessionId) return;
    const summary = await apiFetch<{ rigMismatch: boolean }>(`/autoque/sessions/${sessionId}/summary`, { method: "GET" }, token);
    setRigMismatch(summary.rigMismatch);
  }

  async function analyzeAudio(file: File) {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = 1024;
    const energyCurve = [];
    const markers = [];

    for (let i = 0; i < data.length; i += windowSize) {
      let sum = 0;
      for (let j = 0; j < windowSize && i + j < data.length; j += 1) {
        const sample = data[i + j];
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / windowSize);
      const tMs = Math.floor((i / sampleRate) * 1000);
      energyCurve.push({ tMs, value: Math.min(1, rms * 5) });
    }

    for (let i = 1; i < energyCurve.length - 1; i += 1) {
      const prev = energyCurve[i - 1].value;
      const curr = energyCurve[i].value;
      const next = energyCurve[i + 1].value;
      if (curr > prev && curr > next && curr > 0.4) {
        markers.push({ tMs: energyCurve[i].tMs, type: "BEAT", confidence: Math.min(1, curr) });
      }
    }

    const tempoBpm = estimateTempo(energyCurve);
    const segments = segmentAudio(energyCurve);
    segments
      .filter((segment) => segment.type === "CHORUS" || segment.type === "VERSE")
      .forEach((segment) => {
        markers.push({
          tMs: segment.startMs,
          type: segment.type,
          confidence: 0.6
        });
      });

    return { markers, energyCurve, tempoBpm, segments };
  }

  async function analyzeVideoMotion(file: File) {
    const videoUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
    });

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas context");

    const markers = [];
    const energyCurve = [];
    let lastFrame: Uint8ClampedArray | null = null;
    const step = 0.5;

    for (let t = 0; t < video.duration; t += step) {
      video.currentTime = t;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let diff = 0;
      if (lastFrame) {
        for (let i = 0; i < frame.length; i += 4) {
          diff += Math.abs(frame[i] - lastFrame[i]);
        }
        diff /= frame.length;
      }
      lastFrame = new Uint8ClampedArray(frame);
      const tMs = Math.floor(t * 1000);
      const value = Math.min(1, diff / 25);
      energyCurve.push({ tMs, value });
    }

    for (let i = 1; i < energyCurve.length - 1; i += 1) {
      const prev = energyCurve[i - 1].value;
      const curr = energyCurve[i].value;
      const next = energyCurve[i + 1].value;
      if (curr > prev && curr > next && curr > 0.3) {
        markers.push({ tMs: energyCurve[i].tMs, type: "MOTION_PEAK", confidence: curr });
      }
    }

    URL.revokeObjectURL(videoUrl);
    const tempoBpm = estimateTempo(energyCurve);
    const segments = segmentAudio(energyCurve);
    return { markers, energyCurve, tempoBpm, segments };
  }

  async function runAnalysis() {
    if (!token || !sessionId || !mediaFile) return;
    setAnalysisStatus("Analyzing...");
    const analysis = mediaFile.type.startsWith("video/")
      ? await analyzeVideoMotion(mediaFile)
      : await analyzeAudio(mediaFile);
    await apiFetch(`/autoque/sessions/${sessionId}/analysis`, {
      method: "PATCH",
      body: JSON.stringify(analysis)
    }, token);
    setAnalysisStatus(`Analysis complete (${analysis.markers.length} markers)`);
  }

  function estimateTempo(energyCurve: Array<{ tMs: number; value: number }>) {
    if (energyCurve.length < 8) return 120;
    const peaks = energyCurve.filter((point) => point.value > 0.45).map((point) => point.tMs);
    if (peaks.length < 3) return 120;
    const intervals = peaks.slice(1).map((t, idx) => t - peaks[idx]).filter((ms) => ms > 200);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)] ?? 500;
    const bpm = 60000 / Math.max(250, Math.min(1500, median));
    return Math.round(Math.min(200, Math.max(60, bpm)));
  }

  function segmentAudio(energyCurve: Array<{ tMs: number; value: number }>) {
    if (energyCurve.length < 12) return [];
    const segments = [];
    const windowSize = 10;
    const windowed = [];
    for (let i = 0; i < energyCurve.length - windowSize; i += windowSize) {
      const slice = energyCurve.slice(i, i + windowSize);
      const avg = slice.reduce((sum, p) => sum + p.value, 0) / slice.length;
      windowed.push({ startMs: slice[0].tMs, endMs: slice[slice.length - 1].tMs, avg });
    }

    const avgEnergy = windowed.reduce((sum, w) => sum + w.avg, 0) / windowed.length;
    const highThreshold = Math.min(0.75, avgEnergy + 0.15);
    const lowThreshold = Math.max(0.2, avgEnergy - 0.15);

    windowed.forEach((window, index) => {
      let type = window.avg > highThreshold ? "CHORUS" : "VERSE";
      if (index === 0 && window.avg < lowThreshold) type = "INTRO";
      if (index === windowed.length - 1 && window.avg < lowThreshold) type = "OUTRO";
      if (window.avg < lowThreshold && index > 1 && index < windowed.length - 2) type = "BRIDGE";
      segments.push({ startMs: window.startMs, endMs: window.endMs, type });
    });

    return segments;
  }

  function getActiveCue(timeMs: number) {
    const sorted = [...cueEvents].sort((a, b) => a.t_ms - b.t_ms);
    let active = sorted[0];
    for (const cue of sorted) {
      if (cue.t_ms <= timeMs) {
        active = cue;
      }
    }
    return active;
  }

  function drawPrevis() {
    const canvas = canvasRef.current;
    if (!canvas || !rigDetail?.stageBackgrounds?.[0]) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bg = rigDetail.stageBackgrounds[0];
    const image = new Image();
    image.src = bg.image_url;
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const activeCue = getActiveCue(playheadMs);
      const fixtureTypeMap = new Map(
        rigDetail.fixtureTypes.map((fixture) => [fixture.id, fixture.capabilities?.defaultBeamAngle ?? 30])
      );
      const fixtureMap = new Map(rigDetail.fixtures.map((fixture) => [fixture.id, fixture.fixture_type_id]));

      rigDetail.placements.forEach((placement) => {
        const x = placement.stage_x * canvas.width;
        const y = placement.stage_y * canvas.height;
        ctx.fillStyle = "#d76b6b";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        if (activeCue) {
          const fixtureTypeId = fixtureMap.get(placement.fixture_instance_id);
          const beamAngle = fixtureTypeId ? fixtureTypeMap.get(fixtureTypeId) ?? 30 : 30;
          const length = 120;
          const halfWidth = Math.tan((beamAngle * Math.PI) / 360) * length;
          ctx.fillStyle = "rgba(214, 164, 105, 0.3)";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - halfWidth, y + length);
          ctx.lineTo(x + halfWidth, y + length);
          ctx.closePath();
          ctx.fill();
        }
      });

      ctx.strokeStyle = "#1f9f9a";
      ctx.beginPath();
      const playheadX = (playheadMs / mediaDuration) * canvas.width;
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, canvas.height);
      ctx.stroke();
    };
  }

  useEffect(() => {
    drawPrevis();
  }, [rigDetail, playheadMs, cueEvents]);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } else {
      audio.play();
      setIsPlaying(true);
      const tick = () => {
        setPlayheadMs(Math.floor(audio.currentTime * 1000));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }

  async function addCueEvent() {
    if (!token || !sessionId) return;
    await apiFetch<{ id: string }>(`/autoque/sessions/${sessionId}/cues`, {
      method: "POST",
      body: JSON.stringify({
        tMs: cueTime,
        type: cueType,
        targets: { groupIds: [], fixtureInstanceIds: [] },
        look: { intensity: cueIntensity, paletteColorRef: 0 }
      })
    }, token);
    await loadCueEvents();
  }

  return (
    <section>
      <h2>Create AutoQue Session</h2>
      {message && <p>{message}</p>}
      <label>
        Theatre
        <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rig Version
        <select value={rigVersionId} onChange={(event) => setRigVersionId(event.target.value)}>
          {rigVersions.map((rig) => (
            <option key={rig.id} value={rig.id}>
              {rig.name} ({rig.status})
            </option>
          ))}
        </select>
      </label>
      <label>
        Media URL
        <input value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} />
      </label>
      <label>
        Upload Audio/Video (for analysis)
        <input type="file" accept="audio/*,video/*" onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)} />
      </label>
      <label>
        Duration (ms)
        <input
          type="number"
          value={mediaDuration}
          onChange={(event) => setMediaDuration(Number(event.target.value))}
        />
      </label>
      <label>
        Palette (name,hex;name,hex)
        <input value={palette} onChange={(event) => setPalette(event.target.value)} />
      </label>
      <button type="button" onClick={createSession}>Generate Session</button>
      <button type="button" className="secondary" onClick={runAnalysis} disabled={!mediaFile || !sessionId}>
        Run Analysis
      </button>
      {analysisStatus && <p>{analysisStatus}</p>}

      {sessionId && (
        <section>
          <h3>Timeline</h3>
          <button type="button" className="secondary" onClick={generateDraft}>Generate Draft Cues</button>
          <button type="button" className="secondary" onClick={checkRigMismatch}>Check Rig Mismatch</button>
          {rigMismatch && <p>Warning: Session rig differs from current published rig.</p>}
          <label>
            Cue Time (ms)
            <input type="number" value={cueTime} onChange={(event) => setCueTime(Number(event.target.value))} />
          </label>
          <label>
            Cue Type
            <select value={cueType} onChange={(event) => setCueType(event.target.value)}>
              <option value="LOOK">LOOK</option>
              <option value="BUMP">BUMP</option>
              <option value="CHASE">CHASE</option>
              <option value="SWEEP">SWEEP</option>
              <option value="BLACKOUT">BLACKOUT</option>
              <option value="HIT">HIT</option>
            </select>
          </label>
          <label>
            Intensity
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={cueIntensity}
              onChange={(event) => setCueIntensity(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={addCueEvent}>Add Cue Event</button>
          <button type="button" className="secondary" onClick={loadCueEvents}>Refresh</button>
          <div>
            <button type="button" onClick={togglePlayback}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={mediaDuration}
              value={playheadMs}
              onChange={(event) => setPlayheadMs(Number(event.target.value))}
            />
          </div>
          <audio
            ref={audioRef}
            src={mediaFile ? URL.createObjectURL(mediaFile) : mediaUrl}
            onEnded={() => setIsPlaying(false)}
          />
          <ul>
            {cueEvents.map((cue) => (
              <li key={cue.id}>{cue.t_ms}ms - {cue.type}</li>
            ))}
          </ul>
          {rigDetail?.stageBackgrounds?.[0] && (
            <section>
              <h4>Previs Lite</h4>
              <canvas ref={canvasRef} width={800} height={450} style={{ border: "1px solid #1f2937" }} />
            </section>
          )}
        </section>
      )}
    </section>
  );
}
