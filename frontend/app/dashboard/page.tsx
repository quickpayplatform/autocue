"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface Cue {
  id: string;
  cue_number: number;
  cue_list: number;
  fade_time: number;
  notes: string;
  status: string;
  created_at: string;
}

function parseChannels(raw: string): Array<{ channelNumber: number; level: number }> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [channel, level] = line.split(":").map((value) => value.trim());
      return {
        channelNumber: Number(channel),
        level: Number(level)
      };
    });
}

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [cueNumber, setCueNumber] = useState(1);
  const [cueList, setCueList] = useState(1);
  const [fadeTime, setFadeTime] = useState(0);
  const [notes, setNotes] = useState("");
  const [channels, setChannels] = useState("1:50\n2:75");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("autocue_token");
    setToken(stored);
  }, []);

  async function loadCues() {
    if (!token) return;
    try {
      const data = await apiFetch<Cue[]>("/cues", { method: "GET" }, token);
      setCues(data);
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  }

  useEffect(() => {
    loadCues().catch(() => undefined);
  }, [token]);

  async function submitCue() {
    if (!token) {
      setStatusMessage("Please login first.");
      return;
    }
    setStatusMessage(null);
    try {
      const payload = {
        cueNumber,
        cueList,
        fadeTime,
        notes,
        channels: parseChannels(channels)
      };
      await apiFetch<{ id: string }>("/cues", {
        method: "POST",
        body: JSON.stringify(payload)
      }, token);
      setStatusMessage("Cue submitted.");
      await loadCues();
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  }

  return (
    <section>
      <h2>Submit Cue</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitCue();
        }}
      >
        <label>
          Cue Number
          <input
            type="number"
            min={1}
            value={cueNumber}
            onChange={(event) => setCueNumber(Number(event.target.value))}
          />
        </label>
        <label>
          Cue List
          <input
            type="number"
            min={1}
            value={cueList}
            onChange={(event) => setCueList(Number(event.target.value))}
          />
        </label>
        <label>
          Fade Time (seconds)
          <input
            type="number"
            min={0}
            step={0.1}
            value={fadeTime}
            onChange={(event) => setFadeTime(Number(event.target.value))}
          />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label>
          Channels (one per line: channel:level)
          <textarea
            rows={4}
            value={channels}
            onChange={(event) => setChannels(event.target.value)}
          />
        </label>
        <button type="submit">Submit Cue</button>
      </form>
      {statusMessage && <p>{statusMessage}</p>}
      <section>
        <h3>Your Cue Requests</h3>
        <button type="button" className="secondary" onClick={() => loadCues()}>
          Refresh
        </button>
        <ul>
          {cues.map((cue) => (
            <li key={cue.id}>
              Cue {cue.cue_number}/{cue.cue_list} - {cue.status} (fade {cue.fade_time}s)
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
