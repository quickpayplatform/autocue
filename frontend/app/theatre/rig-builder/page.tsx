"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { applyHomography, computeHomography, invertHomography, Point } from "../../../lib/homography";

interface Venue {
  id: string;
  name: string;
}

interface RigVersion {
  id: string;
  name: string;
  status: string;
}

interface FixtureType {
  id: string;
  manufacturer: string;
  model: string;
}

export default function RigBuilderPage() {
  const [token, setToken] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [rigName, setRigName] = useState("");
  const [rigStatus, setRigStatus] = useState("DRAFT");
  const [rigId, setRigId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [positionName, setPositionName] = useState("");
  const [positionType, setPositionType] = useState("FOH");

  const [fixtureTypes, setFixtureTypes] = useState<FixtureType[]>([]);
  const [fixtureManufacturer, setFixtureManufacturer] = useState("");
  const [fixtureModel, setFixtureModel] = useState("");
  const [fixtureCategory, setFixtureCategory] = useState("LED");
  const [fixtureCapabilities, setFixtureCapabilities] = useState("{}");

  const [fixtureTypeId, setFixtureTypeId] = useState("");
  const [fixturePositionId, setFixturePositionId] = useState("");
  const [fixtureLabel, setFixtureLabel] = useState("");

  const [groupName, setGroupName] = useState("");
  const [groupFixtureIds, setGroupFixtureIds] = useState("");
  const [stageImageUrl, setStageImageUrl] = useState("");
  const [stageWidth, setStageWidth] = useState(40);
  const [stageDepth, setStageDepth] = useState(30);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [derivedTransform, setDerivedTransform] = useState<number[][] | null>(null);
  const [inverseTransform, setInverseTransform] = useState<number[][] | null>(null);
  const [placementFixtureId, setPlacementFixtureId] = useState("");
  const [placedFixtures, setPlacedFixtures] = useState<Array<{ id: string; x: number; y: number }>>([]);
  const [canvasDims] = useState({ width: 800, height: 450 });

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

  async function loadFixtureTypes() {
    if (!token) return;
    const data = await apiFetch<FixtureType[]>("/rigs/fixture-types", { method: "GET" }, token);
    setFixtureTypes(data);
    if (!fixtureTypeId && data.length > 0) {
      setFixtureTypeId(data[0].id);
    }
  }

  useEffect(() => {
    loadVenues().catch((error) => setMessage((error as Error).message));
    loadFixtureTypes().catch((error) => setMessage((error as Error).message));
  }, [token]);

  async function createRig() {
    if (!token || !venueId) return;
    const result = await apiFetch<{ id: string }>("/rigs", {
      method: "POST",
      body: JSON.stringify({ theatreId: venueId, name: rigName, status: rigStatus })
    }, token);
    setRigId(result.id);
    setMessage("Rig version created.");
  }

  async function addPosition() {
    if (!token || !rigId) return;
    await apiFetch<{ id: string }>(`/rigs/${rigId}/positions`, {
      method: "POST",
      body: JSON.stringify({ name: positionName, type: positionType, orderIndex: 0 })
    }, token);
    setMessage("Position added.");
  }

  async function createFixtureType() {
    if (!token) return;
    await apiFetch<{ id: string }>("/rigs/fixture-types", {
      method: "POST",
      body: JSON.stringify({
        manufacturer: fixtureManufacturer,
        model: fixtureModel,
        category: fixtureCategory,
        capabilities: JSON.parse(fixtureCapabilities)
      })
    }, token);
    await loadFixtureTypes();
    setMessage("Fixture type added.");
  }

  async function addFixtureInstance() {
    if (!token || !rigId) return;
    await apiFetch<{ id: string }>(`/rigs/${rigId}/fixtures`, {
      method: "POST",
      body: JSON.stringify({
        fixtureTypeId,
        positionId: fixturePositionId,
        label: fixtureLabel,
        quantity: 1
      })
    }, token);
    setMessage("Fixture instance added.");
  }

  async function addGroup() {
    if (!token || !rigId) return;
    const ids = groupFixtureIds.split(",").map((value) => value.trim()).filter(Boolean);
    await apiFetch<{ id: string }>(`/rigs/${rigId}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: groupName, fixtureInstanceIds: ids })
    }, token);
    setMessage("Group created.");
  }

  function handleCalibrationClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!stageImageUrl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nextPoints = [...calibrationPoints, { x, y }].slice(0, 4);
    setCalibrationPoints(nextPoints);

    if (nextPoints.length === 4) {
      const stagePoints: Point[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ];
      const matrix = computeHomography(stagePoints, nextPoints);
      setDerivedTransform(matrix);
      setInverseTransform(invertHomography(matrix));
    }
  }

  function handlePlacementClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!inverseTransform || !placementFixtureId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const stagePoint = applyHomography(inverseTransform, { x, y });
    const bounded = {
      x: Math.min(1, Math.max(0, stagePoint.x)),
      y: Math.min(1, Math.max(0, stagePoint.y))
    };
    setPlacedFixtures((prev) => [...prev, { id: placementFixtureId, x: bounded.x, y: bounded.y }]);
  }

  async function saveStageBackground() {
    if (!token || !rigId || !derivedTransform) return;
    await apiFetch<{ id: string }>(`/rigs/${rigId}/stage-background`, {
      method: "POST",
      body: JSON.stringify({
        imageUrl: stageImageUrl,
        widthPx: canvasDims.width,
        heightPx: canvasDims.height,
        cameraNotes: "",
        calibration: {
          type: "FOUR_POINT_STAGE_RECT",
          pointsPx: calibrationPoints,
          stageDims: { width: stageWidth, depth: stageDepth, unit: "ft" },
          derivedTransform
        }
      })
    }, token);
    setMessage("Stage background saved.");
  }

  async function savePlacements() {
    if (!token || !rigId) return;
    for (const placement of placedFixtures) {
      await apiFetch<{ id: string }>(`/rigs/${rigId}/placements`, {
        method: "POST",
        body: JSON.stringify({
          fixtureInstanceId: placement.id,
          stageX: placement.x,
          stageY: placement.y,
          photoXpx: null,
          photoYpx: null
        })
      }, token);
    }
    setMessage("Placements saved.");
  }

  return (
    <section>
      <h2>AutoQue Rig Builder</h2>
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

      <section>
        <h3>Create Rig Version</h3>
        <input
          placeholder="Rig name"
          value={rigName}
          onChange={(event) => setRigName(event.target.value)}
        />
        <select value={rigStatus} onChange={(event) => setRigStatus(event.target.value)}>
          <option value="DRAFT">DRAFT</option>
          <option value="PUBLISHED">PUBLISHED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
        <button type="button" onClick={createRig}>Create Rig</button>
      </section>

      <section>
        <h3>Add Position</h3>
        <input
          placeholder="Position name"
          value={positionName}
          onChange={(event) => setPositionName(event.target.value)}
        />
        <select value={positionType} onChange={(event) => setPositionType(event.target.value)}>
          <option value="FOH">FOH</option>
          <option value="ELECTRIC">ELECTRIC</option>
          <option value="BOOM">BOOM</option>
          <option value="BOX_BOOM">BOX_BOOM</option>
          <option value="FLOOR">FLOOR</option>
          <option value="PRACTICAL">PRACTICAL</option>
          <option value="OTHER">OTHER</option>
        </select>
        <button type="button" onClick={addPosition}>Add Position</button>
      </section>

      <section>
        <h3>Fixture Types</h3>
        <input
          placeholder="Manufacturer"
          value={fixtureManufacturer}
          onChange={(event) => setFixtureManufacturer(event.target.value)}
        />
        <input
          placeholder="Model"
          value={fixtureModel}
          onChange={(event) => setFixtureModel(event.target.value)}
        />
        <select value={fixtureCategory} onChange={(event) => setFixtureCategory(event.target.value)}>
          <option value="LED">LED</option>
          <option value="MOVING_LIGHT">MOVING_LIGHT</option>
          <option value="DIMMER">DIMMER</option>
          <option value="PRACTICAL">PRACTICAL</option>
          <option value="EFFECT">EFFECT</option>
          <option value="OTHER">OTHER</option>
        </select>
        <textarea
          rows={3}
          placeholder='Capabilities JSON'
          value={fixtureCapabilities}
          onChange={(event) => setFixtureCapabilities(event.target.value)}
        />
        <button type="button" onClick={createFixtureType}>Add Fixture Type</button>
      </section>

      <section>
        <h3>Add Fixture Instance</h3>
        <select value={fixtureTypeId} onChange={(event) => setFixtureTypeId(event.target.value)}>
          <option value="">Select fixture type</option>
          {fixtureTypes.map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {fixture.manufacturer} {fixture.model}
            </option>
          ))}
        </select>
        <input
          placeholder="Position ID"
          value={fixturePositionId}
          onChange={(event) => setFixturePositionId(event.target.value)}
        />
        <input
          placeholder="Label"
          value={fixtureLabel}
          onChange={(event) => setFixtureLabel(event.target.value)}
        />
        <button type="button" onClick={addFixtureInstance}>Add Fixture</button>
      </section>

      <section>
        <h3>Groups</h3>
        <input
          placeholder="Group name"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
        />
        <input
          placeholder="Fixture IDs (comma separated)"
          value={groupFixtureIds}
          onChange={(event) => setGroupFixtureIds(event.target.value)}
        />
        <button type="button" onClick={addGroup}>Add Group</button>
      </section>

      <section>
        <h3>Stage Background & Calibration</h3>
        <input
          placeholder="Stage image URL"
          value={stageImageUrl}
          onChange={(event) => setStageImageUrl(event.target.value)}
        />
        <div>
          <label>
            Stage Width (ft)
            <input
              type="number"
              value={stageWidth}
              onChange={(event) => setStageWidth(Number(event.target.value))}
            />
          </label>
          <label>
            Stage Depth (ft)
            <input
              type="number"
              value={stageDepth}
              onChange={(event) => setStageDepth(Number(event.target.value))}
            />
          </label>
        </div>
        <p>Click the four stage corners on the image (DSL, DSR, USR, USL).</p>
        <canvas
          width={canvasDims.width}
          height={canvasDims.height}
          onClick={handleCalibrationClick}
          style={{
            border: "1px solid #1f2937",
            background: stageImageUrl ? `url(${stageImageUrl}) center/cover` : "#111"
          }}
        />
        <button type="button" onClick={saveStageBackground} disabled={!derivedTransform}>
          Save Calibration
        </button>
      </section>

      <section>
        <h3>Fixture Placement</h3>
        <input
          placeholder="Fixture Instance ID"
          value={placementFixtureId}
          onChange={(event) => setPlacementFixtureId(event.target.value)}
        />
        <p>Click on the stage image to place fixtures.</p>
        <canvas
          width={canvasDims.width}
          height={canvasDims.height}
          onClick={handlePlacementClick}
          style={{
            border: "1px solid #1f2937",
            background: stageImageUrl ? `url(${stageImageUrl}) center/cover` : "#111"
          }}
        />
        <button type="button" onClick={savePlacements} disabled={placedFixtures.length === 0}>
          Save Placements
        </button>
      </section>
    </section>
  );
}
