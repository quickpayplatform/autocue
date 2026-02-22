"use client";

import { useEffect, useState } from "react";
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
  const [message, setMessage] = useState<string | null>(null);

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

  useEffect(() => {
    loadVenues().catch((error) => setMessage((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (venueId) {
      loadRigVersions(venueId).catch((error) => setMessage((error as Error).message));
    }
  }, [venueId]);

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

      {sessionId && (
        <section>
          <h3>Timeline</h3>
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
          <ul>
            {cueEvents.map((cue) => (
              <li key={cue.id}>{cue.t_ms}ms - {cue.type}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
