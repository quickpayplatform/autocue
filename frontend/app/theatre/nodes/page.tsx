"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

interface Venue {
  id: string;
  name: string;
}

interface NodeInfo {
  id: string;
  display_name: string;
  os: string;
  version: string;
  status: string;
  last_seen_at: string | null;
}

interface DownloadInfo {
  os: string;
  url: string;
  sha256: string;
  version: string;
}

export default function AutoQueNodePage() {
  const [token, setToken] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [pairCode, setPairCode] = useState("");
  const [displayName, setDisplayName] = useState("Main Stage Node");
  const [os, setOs] = useState("macos");
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

  async function loadDownloads() {
    if (!token) return;
    const data = await apiFetch<{ available: boolean; downloads: DownloadInfo[] }>("/api/node-downloads", { method: "GET" }, token);
    setDownloads(data.downloads);
  }

  async function loadNodes(selectedVenueId: string) {
    if (!token || !selectedVenueId) return;
    const data = await apiFetch<NodeInfo[]>(`/api/venues/${selectedVenueId}/nodes`, { method: "GET" }, token);
    setNodes(data);
  }

  useEffect(() => {
    loadVenues().catch((error) => setMessage((error as Error).message));
    loadDownloads().catch((error) => setMessage((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (venueId) {
      loadNodes(venueId).catch((error) => setMessage((error as Error).message));
    }
  }, [venueId]);

  async function claimPair() {
    if (!token || !venueId) return;
    const result = await apiFetch<{ nodeId: string; nodeToken: string }>("/api/node-pair/claim", {
      method: "POST",
      body: JSON.stringify({ code: pairCode, displayName, os, venueId })
    }, token);
    setMessage(`Node paired: ${result.nodeId}`);
    await loadNodes(venueId);
  }

  async function sendTest(nodeId: string) {
    if (!token) return;
    await apiFetch(`/api/nodes/${nodeId}/command`, {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: "osc.send",
        payload: { address: "/eos/newcmd", args: [] }
      })
    }, token);
    setMessage("Test command sent");
  }

  return (
    <section>
      <h2>AutoQue Node</h2>
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
        <h3>Downloads</h3>
        <ul>
          {downloads.map((item) => (
            <li key={item.os}>
              <a href={item.url} target="_blank" rel="noreferrer">{item.os} installer</a>
              {item.version && <span> (v{item.version})</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Add Node</h3>
        <input
          placeholder="Pairing code"
          value={pairCode}
          onChange={(event) => setPairCode(event.target.value)}
        />
        <input
          placeholder="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <select value={os} onChange={(event) => setOs(event.target.value)}>
          <option value="macos">macOS</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
        </select>
        <button type="button" onClick={claimPair}>Pair Node</button>
      </section>

      <section>
        <h3>Nodes</h3>
        <ul>
          {nodes.map((node) => (
            <li key={node.id}>
              {node.display_name} ({node.os}) - {node.status}
              <button type="button" className="secondary" onClick={() => sendTest(node.id)}>
                Send Test
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
