"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface CueSummary {
  id: string;
  cue_number: number;
  cue_list: number;
  fade_time: number;
  notes: string;
  status: string;
  created_at: string;
}

interface CueDetail extends CueSummary {
  channels: Array<{ id: string; channel_number: number; level: number }>;
}

interface Venue {
  id: string;
  name: string;
  role: string;
}

interface CueLog {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
}

export default function OperatorPage() {
  const [token, setToken] = useState<string | null>(null);
  const [cues, setCues] = useState<CueSummary[]>([]);
  const [selected, setSelected] = useState<CueDetail | null>(null);
  const [logs, setLogs] = useState<CueLog[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("autoque_token"));
  }, []);

  async function loadVenues() {
    if (!token) return;
    try {
      const data = await apiFetch<Venue[]>("/venues", { method: "GET" }, token);
      setVenues(data);
      if (!venueId && data.length > 0) {
        setVenueId(data[0].id);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function loadCues(selectedVenueId: string) {
    if (!token || !selectedVenueId) return;
    try {
      const data = await apiFetch<CueSummary[]>(
        `/cues?venueId=${encodeURIComponent(selectedVenueId)}`,
        { method: "GET" },
        token
      );
      setCues(data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  useEffect(() => {
    loadVenues().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (venueId) {
      loadCues(venueId).catch(() => undefined);
    }
  }, [venueId]);

  async function loadDetail(cueId: string) {
    if (!token) return;
    try {
      const data = await apiFetch<CueDetail>(`/cues/${cueId}`, { method: "GET" }, token);
      setSelected(data);
      setLabel(data.notes ?? "");
      const logData = await apiFetch<CueLog[]>(`/cues/${cueId}/logs`, { method: "GET" }, token);
      setLogs(logData);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function approveCue() {
    if (!token || !selected) return;
    setMessage(null);
    try {
      await apiFetch<{ status: string }>(`/cues/${selected.id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ confirmDuplicate, label })
      }, token);
      setMessage("Cue approved.");
      await loadCues(venueId);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function rejectCue() {
    if (!token || !selected) return;
    setMessage(null);
    try {
      await apiFetch<{ status: string }>(`/cues/${selected.id}/reject`, {
        method: "PATCH"
      }, token);
      setMessage("Cue rejected.");
      await loadCues(venueId);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <section>
      <h2>Operator Approval</h2>
      {message && <p>{message}</p>}
      <label>
        Venue
        <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>
      <section>
        <h3>Pending Cues</h3>
        <button type="button" className="secondary" onClick={() => loadCues(venueId)}>
          Refresh
        </button>
        <ul>
          {cues
            .filter((cue) => cue.status === "PENDING")
            .map((cue) => (
              <li key={cue.id}>
                <button type="button" className="secondary" onClick={() => loadDetail(cue.id)}>
                  Cue {cue.cue_number}/{cue.cue_list} - fade {cue.fade_time}s
                </button>
              </li>
            ))}
        </ul>
      </section>

      {selected && (
        <section>
          <h3>Selected Cue</h3>
          <p>
            Cue {selected.cue_number}/{selected.cue_list} - {selected.status}
          </p>
          <p>Notes: {selected.notes}</p>
          <label>
            Operator Label (optional)
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmDuplicate}
              onChange={(event) => setConfirmDuplicate(event.target.checked)}
            />
            Confirm duplicate cue number if prompted
          </label>
          <h4>Channel Preview</h4>
          <ul>
            {selected.channels.map((channel) => (
              <li key={channel.id}>
                Channel {channel.channel_number}: {channel.level}
              </li>
            ))}
          </ul>
          <h4>Execution Logs</h4>
          <ul>
            {logs.map((log) => (
              <li key={log.id}>
                [{new Date(log.created_at).toLocaleString()}] {log.event_type}: {log.message}
              </li>
            ))}
          </ul>
          <div>
            <button type="button" onClick={approveCue}>
              Approve
            </button>
            <button type="button" className="secondary" onClick={rejectCue}>
              Reject
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
